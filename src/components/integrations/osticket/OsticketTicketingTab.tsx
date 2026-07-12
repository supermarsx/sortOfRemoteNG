// OsticketTicketingTab — the `ticketing` category tab for the osTicket panel
// (t42 §4b category c1, exec t42-osticket-c1). The Agent-Panel operational
// surface: the ticket lifecycle plus the requester/end-user directory.
//
// Two grouped sections behind a shared connection:
//   • Tickets  list / search / get / create / update / delete / close / reopen /
//              assign / reply / note / threads / collaborators (get/add/remove) /
//              transfer / merge  — all 17 ticket commands.
//   • Users    list / get / search / create / update / delete / user-tickets
//              — all 7 user commands.
//
// Create/update and reply/note bodies are edited as raw JSON: osTicket write
// payloads carry many optional snake_case fields (status_id, dept_id, sla_id,
// thread_type, org_id, …), so one JSON editor binds every writable field without
// a bespoke form per resource. Reads render as a table plus a JSON inspector
// drawer. Id-only actions (assign / transfer / merge / collaborators) prompt for
// the numeric id(s) inline. `connectionId` is always live — passed as the `id`
// arg to every command.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Loader2,
  MessageSquare,
  Pencil,
  Plus,
  RefreshCw,
  Ticket,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import type { OsticketTabProps } from "./registry";
import { useOsticketTicketing } from "../../../hooks/integration/osticket/useOsticketTicketing";
import type { TicketSearchRequest } from "../../../types/osticket/ticketing";

type Row = Record<string, unknown>;
type Body = Record<string, unknown>;
type SectionKey = "tickets" | "users";

/** Render an osTicket field (scalar / id / null) as a compact string. */
function osLabel(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean")
    return String(v);
  if (Array.isArray(v)) return v.map(osLabel).filter(Boolean).join(", ");
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    const pick = o.name ?? o.email ?? o.title ?? o.number ?? o.id;
    return pick != null ? String(pick) : "";
  }
  return String(v);
}

interface Column {
  key: string;
  labelDefault: string;
}

const TICKET_COLUMNS: Column[] = [
  { key: "number", labelDefault: "Number" },
  { key: "subject", labelDefault: "Subject" },
  { key: "status", labelDefault: "Status" },
  { key: "priority", labelDefault: "Priority" },
  { key: "department", labelDefault: "Department" },
  { key: "user", labelDefault: "Requester" },
  { key: "created", labelDefault: "Created" },
];

const USER_COLUMNS: Column[] = [
  { key: "id", labelDefault: "ID" },
  { key: "name", labelDefault: "Name" },
  { key: "email", labelDefault: "Email" },
  { key: "phone", labelDefault: "Phone" },
  { key: "status", labelDefault: "Status" },
  { key: "created", labelDefault: "Created" },
];

/** Skeleton bodies shown when opening the create editors. */
const NEW_TICKET_JSON = JSON.stringify(
  {
    name: "",
    email: "",
    subject: "",
    message: "",
    topic_id: null,
    dept_id: null,
    priority_id: null,
  },
  null,
  2,
);

const NEW_USER_JSON = JSON.stringify(
  { name: "", email: "", phone: null, notes: null },
  null,
  2,
);

/** JSON editor modal state (create / update / reply / note). */
interface EditorState {
  title: string;
  json: string;
  submit: (body: Body) => Promise<unknown>;
  /** Reload the active list after a successful submit (create/update/delete). */
  reloadAfter: boolean;
}

/** Read-only JSON inspector drawer (detail fetches, threads, collaborators). */
interface InspectorState {
  title: string;
  data: unknown;
}

const btn =
  "flex items-center gap-1 rounded border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-textSecondary)] hover:text-[var(--color-text)] disabled:opacity-50";

const OsticketTicketingTab: React.FC<OsticketTabProps> = ({ connectionId }) => {
  const { t } = useTranslation();
  const { api, items, total, loading, busy, error, loadList, run, clearError } =
    useOsticketTicketing();

  const [section, setSection] = useState<SectionKey>("tickets");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [inspector, setInspector] = useState<InspectorState | null>(null);

  const columns = section === "tickets" ? TICKET_COLUMNS : USER_COLUMNS;

  // ── List loaders ───────────────────────────────────────────────────────────

  const reload = useCallback(() => {
    const q = query.trim();
    if (section === "tickets") {
      if (q || statusFilter) {
        const request: TicketSearchRequest = { limit: 100 };
        if (q) request.query = q;
        if (statusFilter) request.status = statusFilter;
        return loadList(() => api.searchTickets(connectionId, request));
      }
      return loadList(() => api.listTickets(connectionId, 1, 100));
    }
    // users
    if (q) {
      // Heuristic: an @ means search by email, otherwise by name.
      const isEmail = q.includes("@");
      return loadList(() =>
        api.searchUsers(
          connectionId,
          isEmail ? q : undefined,
          isEmail ? undefined : q,
        ),
      );
    }
    return loadList(() => api.listUsers(connectionId, 1, 100));
  }, [section, query, statusFilter, api, connectionId, loadList]);

  // On section change (or reconnect) reset filters and load defaults.
  useEffect(() => {
    setQuery("");
    setStatusFilter("");
    if (section === "tickets") {
      void loadList(() => api.listTickets(connectionId, 1, 100));
    } else {
      void loadList(() => api.listUsers(connectionId, 1, 100));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, connectionId]);

  const rows = items as Row[];

  // ── Shared helpers ───────────────────────────────────────────────────────────

  const openInspect = useCallback(
    async (title: string, action: () => Promise<unknown>) => {
      const data = await run(action);
      if (data !== null) setInspector({ title, data });
    },
    [run],
  );

  const promptNumber = useCallback(
    (message: string): number | null => {
      const raw = window.prompt(message);
      if (raw == null) return null;
      const n = Number(raw.trim());
      if (!Number.isFinite(n)) {
        window.alert(
          t("integrations.osticket.ticketing.notANumber", "Not a valid number."),
        );
        return null;
      }
      return n;
    },
    [t],
  );

  const rowNumericId = (row: Row): number | null => {
    const n = Number(row.id);
    return Number.isFinite(n) ? n : null;
  };

  const closeEditor = useCallback(() => setEditor(null), []);

  const submitEditor = useCallback(async () => {
    if (!editor) return;
    let body: Body;
    try {
      body = JSON.parse(editor.json) as Body;
    } catch {
      window.alert(
        t(
          "integrations.osticket.ticketing.invalidJson",
          "Request body is not valid JSON.",
        ),
      );
      return;
    }
    const res = await run(() => editor.submit(body));
    if (res !== null) {
      setEditor(null);
      if (editor.reloadAfter) void reload();
    }
  }, [editor, run, reload, t]);

  // ── Ticket actions ───────────────────────────────────────────────────────────

  const onViewTicket = useCallback(
    (row: Row) => {
      const id = rowNumericId(row);
      if (id == null) return;
      void openInspect(
        t("integrations.osticket.ticketing.ticket", "Ticket") +
          ` #${osLabel(row.number) || id}`,
        () => api.getTicket(connectionId, id),
      );
    },
    [api, connectionId, openInspect, t],
  );

  const onThreads = useCallback(
    (row: Row) => {
      const id = rowNumericId(row);
      if (id == null) return;
      void openInspect(
        t("integrations.osticket.ticketing.threads", "Threads"),
        () => api.getTicketThreads(connectionId, id),
      );
    },
    [api, connectionId, openInspect, t],
  );

  const openThreadEditor = useCallback(
    (row: Row, kind: "reply" | "note") => {
      const id = rowNumericId(row);
      if (id == null) return;
      setEditor({
        title:
          kind === "reply"
            ? t("integrations.osticket.ticketing.postReply", "Post reply")
            : t("integrations.osticket.ticketing.postNote", "Post internal note"),
        json: JSON.stringify({ body: "" }, null, 2),
        submit: (b) =>
          kind === "reply"
            ? api.postTicketReply(connectionId, id, b as never)
            : api.postTicketNote(connectionId, id, b as never),
        reloadAfter: false,
      });
    },
    [api, connectionId, t],
  );

  const openTicketEdit = useCallback(
    (row: Row) => {
      const id = rowNumericId(row);
      if (id == null) return;
      // Prefill with the current mutable fields (UpdateTicketRequest shape).
      const seed = {
        subject: row.subject ?? null,
        status_id: row.status_id ?? null,
        priority_id: row.priority_id ?? null,
        dept_id: row.department_id ?? null,
        topic_id: row.topic_id ?? null,
        sla_id: row.sla_id ?? null,
        staff_id: row.staff_id ?? null,
        team_id: row.team_id ?? null,
        due_date: row.due_date ?? null,
      };
      setEditor({
        title:
          t("integrations.osticket.ticketing.editTicket", "Edit ticket") +
          ` #${osLabel(row.number) || id}`,
        json: JSON.stringify(seed, null, 2),
        submit: (b) => api.updateTicket(connectionId, id, b as never),
        reloadAfter: true,
      });
    },
    [api, connectionId, t],
  );

  const openCreateTicket = useCallback(() => {
    setEditor({
      title: t("integrations.osticket.ticketing.newTicket", "New ticket"),
      json: NEW_TICKET_JSON,
      submit: (b) => api.createTicket(connectionId, b as never),
      reloadAfter: true,
    });
  }, [api, connectionId, t]);

  const onCloseTicket = useCallback(
    async (row: Row) => {
      const id = rowNumericId(row);
      if (id == null) return;
      const ok = await run(() => api.closeTicket(connectionId, id));
      if (ok !== null) void reload();
    },
    [api, connectionId, run, reload],
  );

  const onReopenTicket = useCallback(
    async (row: Row) => {
      const id = rowNumericId(row);
      if (id == null) return;
      const ok = await run(() => api.reopenTicket(connectionId, id));
      if (ok !== null) void reload();
    },
    [api, connectionId, run, reload],
  );

  const onAssign = useCallback(
    async (row: Row) => {
      const id = rowNumericId(row);
      if (id == null) return;
      const staffRaw = window.prompt(
        t(
          "integrations.osticket.ticketing.assignStaffPrompt",
          "Staff (agent) id to assign — leave blank to assign a team instead:",
        ),
      );
      if (staffRaw == null) return;
      let staffId: number | undefined;
      let teamId: number | undefined;
      if (staffRaw.trim()) {
        const n = Number(staffRaw.trim());
        if (!Number.isFinite(n)) return;
        staffId = n;
      } else {
        const teamRaw = window.prompt(
          t("integrations.osticket.ticketing.assignTeamPrompt", "Team id:"),
        );
        if (teamRaw == null || !teamRaw.trim()) return;
        const n = Number(teamRaw.trim());
        if (!Number.isFinite(n)) return;
        teamId = n;
      }
      const ok = await run(() =>
        api.assignTicket(connectionId, id, staffId, teamId),
      );
      if (ok !== null) void reload();
    },
    [api, connectionId, run, reload, t],
  );

  const onTransfer = useCallback(
    async (row: Row) => {
      const id = rowNumericId(row);
      if (id == null) return;
      const deptId = promptNumber(
        t(
          "integrations.osticket.ticketing.transferPrompt",
          "Destination department id:",
        ),
      );
      if (deptId == null) return;
      const ok = await run(() => api.transferTicket(connectionId, id, deptId));
      if (ok !== null) void reload();
    },
    [api, connectionId, run, reload, promptNumber, t],
  );

  const onMerge = useCallback(
    async (row: Row) => {
      const id = rowNumericId(row);
      if (id == null) return;
      const raw = window.prompt(
        t(
          "integrations.osticket.ticketing.mergePrompt",
          "Ticket ids to merge INTO this one (comma-separated):",
        ),
      );
      if (raw == null) return;
      const mergeIds = raw
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n));
      if (mergeIds.length === 0) return;
      const ok = await run(() => api.mergeTickets(connectionId, id, mergeIds));
      if (ok !== null) void reload();
    },
    [api, connectionId, run, reload, t],
  );

  const onCollaborators = useCallback(
    (row: Row) => {
      const id = rowNumericId(row);
      if (id == null) return;
      void openInspect(
        t("integrations.osticket.ticketing.collaborators", "Collaborators"),
        () => api.getTicketCollaborators(connectionId, id),
      );
    },
    [api, connectionId, openInspect, t],
  );

  const onAddCollaborator = useCallback(
    async (row: Row) => {
      const id = rowNumericId(row);
      if (id == null) return;
      const userId = promptNumber(
        t(
          "integrations.osticket.ticketing.addCollabPrompt",
          "User id to add as collaborator:",
        ),
      );
      if (userId == null) return;
      const email =
        window.prompt(
          t(
            "integrations.osticket.ticketing.addCollabEmailPrompt",
            "Collaborator email (optional):",
          ),
        ) ?? undefined;
      const ok = await run(() =>
        api.addTicketCollaborator(
          connectionId,
          id,
          userId,
          email && email.trim() ? email.trim() : undefined,
        ),
      );
      if (ok !== null) onCollaborators(row);
    },
    [api, connectionId, run, promptNumber, onCollaborators, t],
  );

  const onRemoveCollaborator = useCallback(
    async (row: Row) => {
      const id = rowNumericId(row);
      if (id == null) return;
      const userId = promptNumber(
        t(
          "integrations.osticket.ticketing.removeCollabPrompt",
          "User id to remove as collaborator:",
        ),
      );
      if (userId == null) return;
      const ok = await run(() =>
        api.removeTicketCollaborator(connectionId, id, userId),
      );
      if (ok !== null) onCollaborators(row);
    },
    [api, connectionId, run, promptNumber, onCollaborators, t],
  );

  const onDeleteTicket = useCallback(
    async (row: Row) => {
      const id = rowNumericId(row);
      if (id == null) return;
      if (
        !window.confirm(
          t(
            "integrations.osticket.ticketing.confirmDeleteTicket",
            "Delete ticket #{{n}}?",
            { n: osLabel(row.number) || id },
          ),
        )
      )
        return;
      const ok = await run(() => api.deleteTicket(connectionId, id));
      if (ok !== null) void reload();
    },
    [api, connectionId, run, reload, t],
  );

  // ── User actions ─────────────────────────────────────────────────────────────

  const onViewUser = useCallback(
    (row: Row) => {
      const id = rowNumericId(row);
      if (id == null) return;
      void openInspect(
        t("integrations.osticket.ticketing.user", "User") +
          ` #${id}`,
        () => api.getUser(connectionId, id),
      );
    },
    [api, connectionId, openInspect, t],
  );

  const onUserTickets = useCallback(
    (row: Row) => {
      const id = rowNumericId(row);
      if (id == null) return;
      void openInspect(
        t("integrations.osticket.ticketing.userTickets", "User tickets"),
        () => api.getUserTickets(connectionId, id),
      );
    },
    [api, connectionId, openInspect, t],
  );

  const openUserEdit = useCallback(
    (row: Row) => {
      const id = rowNumericId(row);
      if (id == null) return;
      const seed = {
        name: row.name ?? null,
        email: row.email ?? null,
        phone: row.phone ?? null,
        notes: row.notes ?? null,
        org_id: row.org_id ?? null,
      };
      setEditor({
        title:
          t("integrations.osticket.ticketing.editUser", "Edit user") + ` #${id}`,
        json: JSON.stringify(seed, null, 2),
        submit: (b) => api.updateUser(connectionId, id, b as never),
        reloadAfter: true,
      });
    },
    [api, connectionId, t],
  );

  const openCreateUser = useCallback(() => {
    setEditor({
      title: t("integrations.osticket.ticketing.newUser", "New user"),
      json: NEW_USER_JSON,
      submit: (b) => api.createUser(connectionId, b as never),
      reloadAfter: true,
    });
  }, [api, connectionId, t]);

  const onDeleteUser = useCallback(
    async (row: Row) => {
      const id = rowNumericId(row);
      if (id == null) return;
      if (
        !window.confirm(
          t(
            "integrations.osticket.ticketing.confirmDeleteUser",
            "Delete user {{name}}?",
            { name: osLabel(row.name) || id },
          ),
        )
      )
        return;
      const ok = await run(() => api.deleteUser(connectionId, id));
      if (ok !== null) void reload();
    },
    [api, connectionId, run, reload, t],
  );

  // ── Section tabs meta ────────────────────────────────────────────────────────

  const sections = useMemo(
    () =>
      [
        {
          key: "tickets" as const,
          label: t("integrations.osticket.ticketing.tickets", "Tickets"),
          icon: Ticket,
        },
        {
          key: "users" as const,
          label: t("integrations.osticket.ticketing.users", "Users"),
          icon: Users,
        },
      ],
    [t],
  );

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {/* Section selector */}
      <div className="flex flex-wrap items-center gap-1 border-b border-[var(--color-border)] px-4 py-2">
        {sections.map((s) => {
          const Icon = s.icon;
          const active = s.key === section;
          return (
            <button
              key={s.key}
              onClick={() => setSection(s.key)}
              className={`flex items-center gap-1 rounded px-2.5 py-1 text-xs ${
                active
                  ? "bg-primary text-white"
                  : "text-[var(--color-textSecondary)] hover:bg-[var(--color-surfaceHover)] hover:text-[var(--color-text)]"
              }`}
            >
              <Icon size={13} />
              {s.label}
            </button>
          );
        })}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] px-4 py-2">
        <button onClick={() => void reload()} className={btn} disabled={loading}>
          {loading ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <RefreshCw size={12} />
          )}
          {t("integrations.osticket.ticketing.refresh", "Refresh")}
        </button>

        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void reload()}
          placeholder={
            section === "tickets"
              ? t(
                  "integrations.osticket.ticketing.searchTicketsPlaceholder",
                  "Search tickets…",
                )
              : t(
                  "integrations.osticket.ticketing.searchUsersPlaceholder",
                  "Search users (name or email)…",
                )
          }
          className="w-56 rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-2 py-1 text-xs text-[var(--color-text)]"
        />

        {section === "tickets" && (
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-1.5 py-1 text-xs text-[var(--color-text)]"
          >
            <option value="">
              {t("integrations.osticket.ticketing.statusAny", "Any status")}
            </option>
            <option value="open">
              {t("integrations.osticket.ticketing.statusOpen", "Open")}
            </option>
            <option value="closed">
              {t("integrations.osticket.ticketing.statusClosed", "Closed")}
            </option>
          </select>
        )}

        <button onClick={() => void reload()} className={btn}>
          {t("integrations.osticket.ticketing.search", "Search")}
        </button>

        <div className="ml-auto flex items-center gap-2">
          {total != null && (
            <span className="text-xs text-[var(--color-textMuted)]">
              {t("integrations.osticket.ticketing.count", "{{n}} items", {
                n: total,
              })}
            </span>
          )}
          <button
            onClick={section === "tickets" ? openCreateTicket : openCreateUser}
            className="flex items-center gap-1 rounded bg-primary px-2 py-1 text-xs font-medium text-white"
          >
            <Plus size={12} />
            {section === "tickets"
              ? t("integrations.osticket.ticketing.newTicket", "New ticket")
              : t("integrations.osticket.ticketing.newUser", "New user")}
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center justify-between gap-2 border-b border-[var(--color-border)] bg-[var(--color-error,#ef4444)]/10 px-4 py-1.5 text-xs text-[var(--color-error,#ef4444)]">
          <span>{error}</span>
          <button onClick={clearError} className="shrink-0">
            <X size={12} />
          </button>
        </div>
      )}

      {/* Table */}
      <div className="min-h-0 flex-1 overflow-auto">
        {loading && rows.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex h-full items-center justify-center p-10 text-center text-sm text-[var(--color-textSecondary)]">
            {t("integrations.osticket.ticketing.empty", "No records.")}
          </div>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-[var(--color-surface)] text-[var(--color-textSecondary)]">
              <tr className="border-b border-[var(--color-border)]">
                {columns.map((c) => (
                  <th key={c.key} className="px-3 py-2 font-medium">
                    {t(
                      `integrations.osticket.ticketing.col.${c.key}`,
                      c.labelDefault,
                    )}
                  </th>
                ))}
                <th className="px-3 py-2 text-right font-medium">
                  {t("integrations.osticket.ticketing.col.actions", "Actions")}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr
                  key={osLabel(row.id) || i}
                  className="border-b border-[var(--color-border)] hover:bg-[var(--color-surfaceHover)]"
                >
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className="px-3 py-1.5 text-[var(--color-text)]"
                    >
                      {osLabel(row[c.key])}
                    </td>
                  ))}
                  <td className="px-3 py-1.5">
                    <div className="flex flex-wrap items-center justify-end gap-1">
                      {section === "tickets" ? (
                        <>
                          <button onClick={() => onViewTicket(row)} className={btn}>
                            {t("integrations.osticket.ticketing.view", "View")}
                          </button>
                          <button onClick={() => onThreads(row)} className={btn}>
                            {t("integrations.osticket.ticketing.threads", "Threads")}
                          </button>
                          <button
                            onClick={() => openThreadEditor(row, "reply")}
                            className={btn}
                            title={t(
                              "integrations.osticket.ticketing.postReply",
                              "Post reply",
                            )}
                          >
                            <MessageSquare size={12} />
                            {t("integrations.osticket.ticketing.reply", "Reply")}
                          </button>
                          <button
                            onClick={() => openThreadEditor(row, "note")}
                            className={btn}
                          >
                            {t("integrations.osticket.ticketing.note", "Note")}
                          </button>
                          <button
                            onClick={() => openTicketEdit(row)}
                            className={btn}
                            title={t("integrations.osticket.ticketing.edit", "Edit")}
                          >
                            <Pencil size={12} />
                          </button>
                          <button onClick={() => void onAssign(row)} className={btn}>
                            {t("integrations.osticket.ticketing.assign", "Assign")}
                          </button>
                          <button
                            onClick={() => void onTransfer(row)}
                            className={btn}
                          >
                            {t("integrations.osticket.ticketing.transfer", "Transfer")}
                          </button>
                          <button onClick={() => void onMerge(row)} className={btn}>
                            {t("integrations.osticket.ticketing.merge", "Merge")}
                          </button>
                          <button
                            onClick={() => onCollaborators(row)}
                            className={btn}
                          >
                            {t(
                              "integrations.osticket.ticketing.collab",
                              "Collab.",
                            )}
                          </button>
                          <button
                            onClick={() => void onAddCollaborator(row)}
                            className={btn}
                          >
                            {t("integrations.osticket.ticketing.collabAdd", "+CC")}
                          </button>
                          <button
                            onClick={() => void onRemoveCollaborator(row)}
                            className={btn}
                          >
                            {t("integrations.osticket.ticketing.collabRemove", "-CC")}
                          </button>
                          <button
                            onClick={() => void onCloseTicket(row)}
                            className={btn}
                          >
                            {t("integrations.osticket.ticketing.close", "Close")}
                          </button>
                          <button
                            onClick={() => void onReopenTicket(row)}
                            className={btn}
                          >
                            {t("integrations.osticket.ticketing.reopen", "Reopen")}
                          </button>
                          <button
                            onClick={() => void onDeleteTicket(row)}
                            className={btn}
                            title={t("integrations.osticket.ticketing.delete", "Delete")}
                          >
                            <Trash2 size={12} />
                          </button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => onViewUser(row)} className={btn}>
                            {t("integrations.osticket.ticketing.view", "View")}
                          </button>
                          <button
                            onClick={() => onUserTickets(row)}
                            className={btn}
                          >
                            {t(
                              "integrations.osticket.ticketing.tickets",
                              "Tickets",
                            )}
                          </button>
                          <button
                            onClick={() => openUserEdit(row)}
                            className={btn}
                            title={t("integrations.osticket.ticketing.edit", "Edit")}
                          >
                            <Pencil size={12} />
                          </button>
                          <button
                            onClick={() => void onDeleteUser(row)}
                            className={btn}
                            title={t("integrations.osticket.ticketing.delete", "Delete")}
                          >
                            <Trash2 size={12} />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* JSON editor modal */}
      {editor && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/40 p-6">
          <div className="flex max-h-full w-full max-w-lg flex-col rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl">
            <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-2.5">
              <h3 className="text-sm font-semibold text-[var(--color-text)]">
                {editor.title}
              </h3>
              <button
                onClick={closeEditor}
                className="text-[var(--color-textSecondary)]"
              >
                <X size={16} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-4">
              <textarea
                value={editor.json}
                onChange={(e) => setEditor({ ...editor, json: e.target.value })}
                spellCheck={false}
                className="h-64 w-full resize-none rounded border border-[var(--color-border)] bg-[var(--color-surfaceHover)] p-2 font-mono text-xs text-[var(--color-text)]"
              />
              <p className="mt-1 text-[11px] text-[var(--color-textMuted)]">
                {t(
                  "integrations.osticket.ticketing.editorHint",
                  "Raw osTicket JSON body. Field names are snake_case (status_id, dept_id, org_id …).",
                )}
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-[var(--color-border)] px-4 py-2.5">
              <button onClick={closeEditor} className={btn}>
                {t("integrations.osticket.ticketing.cancel", "Cancel")}
              </button>
              <button
                onClick={() => void submitEditor()}
                disabled={busy}
                className="flex items-center gap-1 rounded bg-primary px-3 py-1 text-xs font-medium text-white disabled:opacity-60"
              >
                {busy && <Loader2 size={12} className="animate-spin" />}
                {t("integrations.osticket.ticketing.save", "Save")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Inspector drawer */}
      {inspector && (
        <div className="absolute inset-y-0 right-0 z-10 flex w-full max-w-md flex-col border-l border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl">
          <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-2.5">
            <h3 className="truncate text-sm font-semibold text-[var(--color-text)]">
              {inspector.title}
            </h3>
            <button
              onClick={() => setInspector(null)}
              className="text-[var(--color-textSecondary)]"
            >
              <X size={16} />
            </button>
          </div>
          <pre className="min-h-0 flex-1 overflow-auto p-4 font-mono text-[11px] leading-relaxed text-[var(--color-text)]">
            {JSON.stringify(inspector.data, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
};

export default OsticketTicketingTab;
