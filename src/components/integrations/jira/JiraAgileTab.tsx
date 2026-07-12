// Jira — "Projects & Agile" sub-tab (t42-jira-c2).
//
// Binds all 29 `agile`-category commands across five grouped sections:
//   Projects (7) · Boards (5) · Sprints (9) · Dashboards (2) · Filters (6)
// Each section pairs 1:1 with a command block in `useJiraAgile` /
// `sorng-jira/src/commands.rs`. Mounted only when the panel shell is connected,
// so every call targets the single live `connectionId` passed in as a prop.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Loader2,
  RefreshCw,
  Plus,
  Trash2,
  FileText,
  Play,
  CheckCircle2,
  Send,
  Star,
  ChevronRight,
  ChevronDown,
  X,
  FolderKanban,
  LayoutDashboard,
  Filter as FilterIcon,
  Columns3,
  Timer,
} from "lucide-react";

import { useJiraAgile, type JiraAgileManager } from "../../../hooks/integration/jira/useJiraAgile";
import type { JiraTabProps } from "./registry";
import type { JiraIssue, JiraSearchResponse } from "../../../types/jira";
import type {
  CreateFilterRequest,
  CreateProjectRequest,
  CreateSprintRequest,
  JiraBoard,
  JiraDashboard,
  JiraFilter,
  JiraProject,
  JiraSprint,
  UpdateSprintRequest,
} from "../../../types/jira/agile";

// ─── Shared styling (mirrors the panel shell / sibling tabs) ────────────────────

const inputClass =
  "w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs text-[var(--color-text)] focus:border-primary focus:outline-none";
const labelClass =
  "mb-1 block text-[11px] font-medium text-[var(--color-textSecondary)]";
const btnClass =
  "flex items-center gap-1 rounded border border-[var(--color-border)] px-2 py-1 text-[11px] text-[var(--color-text)] hover:bg-[var(--color-surfaceHover)] disabled:opacity-50";
const primaryBtn =
  "flex items-center gap-1 rounded bg-primary px-2 py-1 text-[11px] text-white disabled:opacity-50";

type SectionKey = "projects" | "boards" | "sprints" | "dashboards" | "filters";

const SECTIONS: { key: SectionKey; label: string; icon: React.ReactNode }[] = [
  { key: "projects", label: "Projects", icon: <FolderKanban size={13} /> },
  { key: "boards", label: "Boards", icon: <Columns3 size={13} /> },
  { key: "sprints", label: "Sprints", icon: <Timer size={13} /> },
  { key: "dashboards", label: "Dashboards", icon: <LayoutDashboard size={13} /> },
  { key: "filters", label: "Filters", icon: <FilterIcon size={13} /> },
];

const JiraAgileTab: React.FC<JiraTabProps> = ({ connectionId }) => {
  const { t } = useTranslation();
  const mgr = useJiraAgile();
  const { isLoading, error, clearError } = mgr;
  const [section, setSection] = useState<SectionKey>("projects");

  return (
    <div className="flex flex-col gap-3 p-3">
      {/* Section switcher */}
      <div className="flex flex-wrap gap-1">
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            onClick={() => setSection(s.key)}
            className={`flex items-center gap-1 rounded px-2 py-1 text-[11px] ${
              section === s.key
                ? "bg-primary text-white"
                : "text-[var(--color-textSecondary)] hover:bg-[var(--color-surfaceHover)]"
            }`}
          >
            {s.icon}
            {t(`integrations.jira.agile.section.${s.key}`, s.label)}
          </button>
        ))}
        {isLoading && (
          <span className="ml-auto flex items-center gap-1 text-[11px] text-[var(--color-textSecondary)]">
            <Loader2 size={12} className="animate-spin" />
          </span>
        )}
      </div>

      {error && (
        <div className="flex items-start justify-between gap-2 rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-[11px] text-red-500">
          <span className="break-all">{error}</span>
          <button onClick={clearError} aria-label="dismiss">
            <X size={12} />
          </button>
        </div>
      )}

      {section === "projects" && <ProjectsSection mgr={mgr} id={connectionId} />}
      {section === "boards" && <BoardsSection mgr={mgr} id={connectionId} />}
      {section === "sprints" && <SprintsSection mgr={mgr} id={connectionId} />}
      {section === "dashboards" && (
        <DashboardsSection mgr={mgr} id={connectionId} />
      )}
      {section === "filters" && <FiltersSection mgr={mgr} id={connectionId} />}
    </div>
  );
};

// ─── Projects (7) ───────────────────────────────────────────────────────────--

const ProjectsSection: React.FC<{ mgr: JiraAgileManager; id: string }> = ({
  mgr,
  id,
}) => {
  const { t } = useTranslation();
  const { run, isLoading } = mgr;
  const [projects, setProjects] = useState<JiraProject[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const reload = useCallback(async () => {
    const list = await run((a) => a.listProjects(id));
    if (list) setProjects(list);
  }, [run, id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => void reload()} className={btnClass} disabled={isLoading}>
          <RefreshCw size={12} />
          {t("integrations.jira.agile.refresh", "Refresh")}
        </button>
        <button onClick={() => setShowCreate((s) => !s)} className={primaryBtn}>
          <Plus size={12} />
          {t("integrations.jira.agile.projects.new", "New project")}
        </button>
      </div>

      {showCreate && (
        <CreateProjectForm
          mgr={mgr}
          id={id}
          onDone={() => {
            setShowCreate(false);
            void reload();
          }}
        />
      )}

      <div className="overflow-x-auto rounded border border-[var(--color-border)]">
        <table className="w-full text-left text-[11px]">
          <thead className="bg-[var(--color-surfaceHover)] text-[var(--color-textSecondary)]">
            <tr>
              <th className="px-2 py-1"></th>
              <th className="px-2 py-1">{t("integrations.jira.agile.col.key", "Key")}</th>
              <th className="px-2 py-1">{t("integrations.jira.agile.col.name", "Name")}</th>
              <th className="px-2 py-1">{t("integrations.jira.agile.col.type", "Type")}</th>
              <th className="px-2 py-1 text-right">
                {t("integrations.jira.agile.col.actions", "Actions")}
              </th>
            </tr>
          </thead>
          <tbody>
            {projects.length === 0 && (
              <tr>
                <td colSpan={5} className="px-2 py-4 text-center text-[var(--color-textSecondary)]">
                  {t("integrations.jira.agile.projects.empty", "No projects.")}
                </td>
              </tr>
            )}
            {projects.map((p) => {
              const key = p.key ?? p.id ?? "";
              const open = selected === key;
              return (
                <React.Fragment key={key}>
                  <tr className="border-t border-[var(--color-border)]">
                    <td className="px-2 py-1">
                      <button onClick={() => setSelected(open ? null : key)} aria-label="toggle">
                        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      </button>
                    </td>
                    <td className="px-2 py-1 font-medium text-[var(--color-text)]">{p.key ?? "—"}</td>
                    <td className="px-2 py-1">{p.name ?? "—"}</td>
                    <td className="px-2 py-1">{p.projectTypeKey ?? "—"}</td>
                    <td className="px-2 py-1">
                      <div className="flex justify-end gap-1">
                        <IconBtn
                          title={t("integrations.jira.agile.action.delete", "Delete")}
                          onClick={() =>
                            run((a) => a.deleteProject(id, key)).then(() => {
                              setSelected(null);
                              return run((a) => a.listProjects(id)).then(
                                (l) => l && setProjects(l),
                              );
                            })
                          }
                        >
                          <Trash2 size={12} />
                        </IconBtn>
                      </div>
                    </td>
                  </tr>
                  {open && (
                    <tr className="border-t border-[var(--color-border)] bg-[var(--color-surfaceHover)]/40">
                      <td colSpan={5} className="px-2 py-2">
                        <ProjectDetail mgr={mgr} id={id} projectKey={key} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const ProjectDetail: React.FC<{
  mgr: JiraAgileManager;
  id: string;
  projectKey: string;
}> = ({ mgr, id, projectKey }) => {
  const { t } = useTranslation();
  const { run } = mgr;
  const [detail, setDetail] = useState<JiraProject | null>(null);
  const [payload, setPayload] = useState<unknown>(null);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1">
        <button
          className={btnClass}
          onClick={() => run((a) => a.getProject(id, projectKey)).then((d) => d && setDetail(d))}
        >
          <FileText size={12} />
          {t("integrations.jira.agile.projects.view", "View")}
        </button>
        <button
          className={btnClass}
          onClick={() =>
            run((a) => a.getProjectStatuses(id, projectKey)).then((d) => d && setPayload(d))
          }
        >
          {t("integrations.jira.agile.projects.statuses", "Statuses")}
        </button>
        <button
          className={btnClass}
          onClick={() =>
            run((a) => a.getProjectComponents(id, projectKey)).then((d) => d && setPayload(d))
          }
        >
          {t("integrations.jira.agile.projects.components", "Components")}
        </button>
        <button
          className={btnClass}
          onClick={() =>
            run((a) => a.getProjectVersions(id, projectKey)).then((d) => d && setPayload(d))
          }
        >
          {t("integrations.jira.agile.projects.versions", "Versions")}
        </button>
      </div>
      {detail && <JsonView value={detail} />}
      {payload != null && <JsonView value={payload} />}
    </div>
  );
};

const CreateProjectForm: React.FC<{
  mgr: JiraAgileManager;
  id: string;
  onDone: () => void;
}> = ({ mgr, id, onDone }) => {
  const { t } = useTranslation();
  const { run, isLoading } = mgr;
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [projectTypeKey, setProjectTypeKey] = useState("software");
  const [leadAccountId, setLeadAccountId] = useState("");
  const [description, setDescription] = useState("");
  const [url, setUrl] = useState("");
  const [assigneeType, setAssigneeType] = useState("");

  const submit = useCallback(async () => {
    const request: CreateProjectRequest = {
      key: key.trim(),
      name: name.trim(),
      projectTypeKey: projectTypeKey.trim(),
      // NOTE: snake_case wire field (NO serde rename) — must match the Rust struct.
      lead_account_id: leadAccountId.trim() || undefined,
      description: description.trim() || undefined,
      url: url.trim() || undefined,
      assigneeType: assigneeType.trim() || undefined,
    };
    const created = await run((a) => a.createProject(id, request));
    if (created) onDone();
  }, [run, id, key, name, projectTypeKey, leadAccountId, description, url, assigneeType, onDone]);

  return (
    <div className="rounded border border-[var(--color-border)] p-2">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Field label={t("integrations.jira.agile.projects.key", "Key")}>
          <input className={inputClass} value={key} onChange={(e) => setKey(e.target.value)} placeholder="ACME" />
        </Field>
        <Field label={t("integrations.jira.agile.col.name", "Name")}>
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t("integrations.jira.agile.projects.typeKey", "Project type key")}>
          <input className={inputClass} value={projectTypeKey} onChange={(e) => setProjectTypeKey(e.target.value)} placeholder="software" />
        </Field>
        <Field label={t("integrations.jira.agile.projects.leadAccountId", "Lead account id")}>
          <input className={inputClass} value={leadAccountId} onChange={(e) => setLeadAccountId(e.target.value)} />
        </Field>
        <Field label={t("integrations.jira.agile.projects.assigneeType", "Assignee type")}>
          <input className={inputClass} value={assigneeType} onChange={(e) => setAssigneeType(e.target.value)} placeholder="PROJECT_LEAD" />
        </Field>
        <Field label={t("integrations.jira.agile.projects.url", "URL")}>
          <input className={inputClass} value={url} onChange={(e) => setUrl(e.target.value)} />
        </Field>
      </div>
      <div className="mt-2">
        <Field label={t("integrations.jira.agile.projects.description", "Description")}>
          <textarea className={inputClass} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
      </div>
      <div className="mt-2 flex gap-1">
        <button
          className={primaryBtn}
          disabled={isLoading || !key.trim() || !name.trim() || !projectTypeKey.trim()}
          onClick={() => void submit()}
        >
          {isLoading ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
          {t("integrations.jira.agile.create", "Create")}
        </button>
        <button className={btnClass} onClick={onDone}>
          {t("integrations.jira.agile.cancel", "Cancel")}
        </button>
      </div>
    </div>
  );
};

// ─── Boards (5) ─────────────────────────────────────────────────────────────--

const BoardsSection: React.FC<{ mgr: JiraAgileManager; id: string }> = ({ mgr, id }) => {
  const { t } = useTranslation();
  const { run, isLoading } = mgr;
  const [boards, setBoards] = useState<JiraBoard[]>([]);
  const [projectKey, setProjectKey] = useState("");
  const [boardType, setBoardType] = useState("");
  const [selected, setSelected] = useState<number | null>(null);

  const reload = useCallback(async () => {
    const res = await run((a) =>
      a.listBoards(
        id,
        undefined,
        undefined,
        projectKey.trim() || undefined,
        boardType.trim() || undefined,
      ),
    );
    if (res) setBoards(res.values);
  }, [run, id, projectKey, boardType]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-40">
          <label className={labelClass}>
            {t("integrations.jira.agile.boards.projectKey", "Project key filter")}
          </label>
          <input className={inputClass} value={projectKey} onChange={(e) => setProjectKey(e.target.value)} placeholder="ACME" />
        </div>
        <div className="w-40">
          <label className={labelClass}>{t("integrations.jira.agile.boards.type", "Board type")}</label>
          <select className={inputClass} value={boardType} onChange={(e) => setBoardType(e.target.value)}>
            <option value="">{t("integrations.jira.agile.boards.anyType", "Any")}</option>
            <option value="scrum">scrum</option>
            <option value="kanban">kanban</option>
            <option value="simple">simple</option>
          </select>
        </div>
        <button onClick={() => void reload()} className={btnClass} disabled={isLoading}>
          <RefreshCw size={12} />
          {t("integrations.jira.agile.refresh", "Refresh")}
        </button>
      </div>

      <div className="overflow-x-auto rounded border border-[var(--color-border)]">
        <table className="w-full text-left text-[11px]">
          <thead className="bg-[var(--color-surfaceHover)] text-[var(--color-textSecondary)]">
            <tr>
              <th className="px-2 py-1"></th>
              <th className="px-2 py-1">{t("integrations.jira.agile.col.id", "Id")}</th>
              <th className="px-2 py-1">{t("integrations.jira.agile.col.name", "Name")}</th>
              <th className="px-2 py-1">{t("integrations.jira.agile.col.type", "Type")}</th>
              <th className="px-2 py-1">{t("integrations.jira.agile.boards.location", "Location")}</th>
            </tr>
          </thead>
          <tbody>
            {boards.length === 0 && (
              <tr>
                <td colSpan={5} className="px-2 py-4 text-center text-[var(--color-textSecondary)]">
                  {t("integrations.jira.agile.boards.empty", "No boards.")}
                </td>
              </tr>
            )}
            {boards.map((b) => {
              const open = selected === b.id;
              return (
                <React.Fragment key={b.id}>
                  <tr className="border-t border-[var(--color-border)]">
                    <td className="px-2 py-1">
                      <button onClick={() => setSelected(open ? null : b.id)} aria-label="toggle">
                        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      </button>
                    </td>
                    <td className="px-2 py-1 font-medium text-[var(--color-text)]">{b.id}</td>
                    <td className="px-2 py-1">{b.name ?? "—"}</td>
                    <td className="px-2 py-1">{b.type ?? "—"}</td>
                    <td className="px-2 py-1">{b.location?.projectKey ?? b.location?.displayName ?? "—"}</td>
                  </tr>
                  {open && (
                    <tr className="border-t border-[var(--color-border)] bg-[var(--color-surfaceHover)]/40">
                      <td colSpan={5} className="px-2 py-2">
                        <BoardDetail mgr={mgr} id={id} boardId={b.id} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const BoardDetail: React.FC<{
  mgr: JiraAgileManager;
  id: string;
  boardId: number;
}> = ({ mgr, id, boardId }) => {
  const { t } = useTranslation();
  const { run } = mgr;
  const [board, setBoard] = useState<JiraBoard | null>(null);
  const [config, setConfig] = useState<unknown>(null);
  const [issues, setIssues] = useState<JiraSearchResponse | null>(null);
  const [jql, setJql] = useState("");

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-1">
        <button className={btnClass} onClick={() => run((a) => a.getBoard(id, boardId)).then((d) => d && setBoard(d))}>
          <FileText size={12} />
          {t("integrations.jira.agile.boards.view", "View")}
        </button>
        <button
          className={btnClass}
          onClick={() => run((a) => a.getBoardConfiguration(id, boardId)).then((d) => d && setConfig(d))}
        >
          {t("integrations.jira.agile.boards.config", "Configuration")}
        </button>
        <button
          className={btnClass}
          onClick={() =>
            run((a) => a.getBoardBacklog(id, boardId, undefined, undefined)).then((d) => d && setIssues(d))
          }
        >
          {t("integrations.jira.agile.boards.backlog", "Backlog")}
        </button>
      </div>
      <div className="flex items-end gap-1">
        <div className="flex-1">
          <label className={labelClass}>{t("integrations.jira.agile.boards.jql", "Issues JQL (optional)")}</label>
          <input className={inputClass} value={jql} onChange={(e) => setJql(e.target.value)} placeholder="status = Done" />
        </div>
        <button
          className={btnClass}
          onClick={() =>
            run((a) => a.getBoardIssues(id, boardId, undefined, undefined, jql.trim() || undefined)).then(
              (d) => d && setIssues(d),
            )
          }
        >
          {t("integrations.jira.agile.boards.issues", "Issues")}
        </button>
      </div>
      {board && <JsonView value={board} />}
      {config != null && <JsonView value={config} />}
      {issues && <IssueList res={issues} />}
    </div>
  );
};

// ─── Sprints (9) ────────────────────────────────────────────────────────────--

const SprintsSection: React.FC<{ mgr: JiraAgileManager; id: string }> = ({ mgr, id }) => {
  const { t } = useTranslation();
  const { run, isLoading } = mgr;
  const [boardId, setBoardId] = useState("");
  const [sprintState, setSprintState] = useState("");
  const [sprints, setSprints] = useState<JiraSprint[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const boardIdNum = Number(boardId);
  const boardValid = boardId.trim() !== "" && Number.isFinite(boardIdNum);

  const reload = useCallback(async () => {
    if (!boardValid) return;
    const res = await run((a) =>
      a.listSprints(id, boardIdNum, undefined, undefined, sprintState.trim() || undefined),
    );
    if (res) setSprints(res.values);
  }, [run, id, boardIdNum, boardValid, sprintState]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-32">
          <label className={labelClass}>{t("integrations.jira.agile.sprints.boardId", "Board id")}</label>
          <input
            className={inputClass}
            type="number"
            value={boardId}
            onChange={(e) => setBoardId(e.target.value)}
            placeholder="1"
          />
        </div>
        <div className="w-40">
          <label className={labelClass}>{t("integrations.jira.agile.sprints.state", "State")}</label>
          <select className={inputClass} value={sprintState} onChange={(e) => setSprintState(e.target.value)}>
            <option value="">{t("integrations.jira.agile.sprints.anyState", "Any")}</option>
            <option value="future">future</option>
            <option value="active">active</option>
            <option value="closed">closed</option>
          </select>
        </div>
        <button onClick={() => void reload()} className={btnClass} disabled={isLoading || !boardValid}>
          <RefreshCw size={12} />
          {t("integrations.jira.agile.sprints.list", "List sprints")}
        </button>
        <button
          onClick={() => setShowCreate((s) => !s)}
          className={primaryBtn}
          disabled={!boardValid}
        >
          <Plus size={12} />
          {t("integrations.jira.agile.sprints.new", "New sprint")}
        </button>
      </div>

      {showCreate && boardValid && (
        <CreateSprintForm
          mgr={mgr}
          id={id}
          boardId={boardIdNum}
          onDone={() => {
            setShowCreate(false);
            void reload();
          }}
        />
      )}

      <div className="overflow-x-auto rounded border border-[var(--color-border)]">
        <table className="w-full text-left text-[11px]">
          <thead className="bg-[var(--color-surfaceHover)] text-[var(--color-textSecondary)]">
            <tr>
              <th className="px-2 py-1"></th>
              <th className="px-2 py-1">{t("integrations.jira.agile.col.id", "Id")}</th>
              <th className="px-2 py-1">{t("integrations.jira.agile.col.name", "Name")}</th>
              <th className="px-2 py-1">{t("integrations.jira.agile.col.state", "State")}</th>
              <th className="px-2 py-1 text-right">{t("integrations.jira.agile.col.actions", "Actions")}</th>
            </tr>
          </thead>
          <tbody>
            {sprints.length === 0 && (
              <tr>
                <td colSpan={5} className="px-2 py-4 text-center text-[var(--color-textSecondary)]">
                  {t("integrations.jira.agile.sprints.empty", "No sprints — enter a board id and list.")}
                </td>
              </tr>
            )}
            {sprints.map((sp) => {
              const open = selected === sp.id;
              return (
                <React.Fragment key={sp.id}>
                  <tr className="border-t border-[var(--color-border)]">
                    <td className="px-2 py-1">
                      <button onClick={() => setSelected(open ? null : sp.id)} aria-label="toggle">
                        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      </button>
                    </td>
                    <td className="px-2 py-1 font-medium text-[var(--color-text)]">{sp.id}</td>
                    <td className="px-2 py-1">{sp.name ?? "—"}</td>
                    <td className="px-2 py-1">{sp.state ?? "—"}</td>
                    <td className="px-2 py-1">
                      <div className="flex justify-end gap-1">
                        <IconBtn
                          title={t("integrations.jira.agile.sprints.start", "Start")}
                          onClick={() => run((a) => a.startSprint(id, sp.id)).then(reload)}
                        >
                          <Play size={12} />
                        </IconBtn>
                        <IconBtn
                          title={t("integrations.jira.agile.sprints.complete", "Complete")}
                          onClick={() => run((a) => a.completeSprint(id, sp.id)).then(reload)}
                        >
                          <CheckCircle2 size={12} />
                        </IconBtn>
                        <IconBtn
                          title={t("integrations.jira.agile.action.delete", "Delete")}
                          onClick={() =>
                            run((a) => a.deleteSprint(id, sp.id)).then(() => {
                              setSelected(null);
                              return reload();
                            })
                          }
                        >
                          <Trash2 size={12} />
                        </IconBtn>
                      </div>
                    </td>
                  </tr>
                  {open && (
                    <tr className="border-t border-[var(--color-border)] bg-[var(--color-surfaceHover)]/40">
                      <td colSpan={5} className="px-2 py-2">
                        <SprintDetail mgr={mgr} id={id} sprint={sp} onChanged={reload} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const CreateSprintForm: React.FC<{
  mgr: JiraAgileManager;
  id: string;
  boardId: number;
  onDone: () => void;
}> = ({ mgr, id, boardId, onDone }) => {
  const { t } = useTranslation();
  const { run, isLoading } = mgr;
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [goal, setGoal] = useState("");

  const submit = useCallback(async () => {
    const request: CreateSprintRequest = {
      name: name.trim(),
      originBoardId: boardId,
      startDate: startDate.trim() || undefined,
      endDate: endDate.trim() || undefined,
      goal: goal.trim() || undefined,
    };
    const created = await run((a) => a.createSprint(id, request));
    if (created) onDone();
  }, [run, id, boardId, name, startDate, endDate, goal, onDone]);

  return (
    <div className="rounded border border-[var(--color-border)] p-2">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Field label={t("integrations.jira.agile.col.name", "Name")}>
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t("integrations.jira.agile.sprints.goal", "Goal")}>
          <input className={inputClass} value={goal} onChange={(e) => setGoal(e.target.value)} />
        </Field>
        <Field label={t("integrations.jira.agile.sprints.startDate", "Start date (ISO)")}>
          <input className={inputClass} value={startDate} onChange={(e) => setStartDate(e.target.value)} placeholder="2026-07-01T09:00:00.000Z" />
        </Field>
        <Field label={t("integrations.jira.agile.sprints.endDate", "End date (ISO)")}>
          <input className={inputClass} value={endDate} onChange={(e) => setEndDate(e.target.value)} placeholder="2026-07-14T17:00:00.000Z" />
        </Field>
      </div>
      <div className="mt-2 flex gap-1">
        <button className={primaryBtn} disabled={isLoading || !name.trim()} onClick={() => void submit()}>
          {isLoading ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
          {t("integrations.jira.agile.create", "Create")}
        </button>
        <button className={btnClass} onClick={onDone}>
          {t("integrations.jira.agile.cancel", "Cancel")}
        </button>
      </div>
    </div>
  );
};

const SprintDetail: React.FC<{
  mgr: JiraAgileManager;
  id: string;
  sprint: JiraSprint;
  onChanged: () => Promise<void>;
}> = ({ mgr, id, sprint, onChanged }) => {
  const { t } = useTranslation();
  const { run } = mgr;
  const [detail, setDetail] = useState<JiraSprint | null>(null);
  const [issues, setIssues] = useState<JiraSearchResponse | null>(null);
  const [moveIssues, setMoveIssues] = useState("");
  // Edit fields (update_sprint) prefilled from the row.
  const [name, setName] = useState(sprint.name ?? "");
  const [state, setState] = useState(sprint.state ?? "");
  const [startDate, setStartDate] = useState(sprint.startDate ?? "");
  const [endDate, setEndDate] = useState(sprint.endDate ?? "");
  const [goal, setGoal] = useState(sprint.goal ?? "");

  const saveUpdate = useCallback(async () => {
    const request: UpdateSprintRequest = {
      name: name.trim() || undefined,
      state: state.trim() || undefined,
      startDate: startDate.trim() || undefined,
      endDate: endDate.trim() || undefined,
      goal: goal.trim() || undefined,
    };
    const updated = await run((a) => a.updateSprint(id, sprint.id, request));
    if (updated) await onChanged();
  }, [run, id, sprint.id, name, state, startDate, endDate, goal, onChanged]);

  return (
    <div className="flex flex-col gap-3">
      {/* View + issues */}
      <div className="flex flex-wrap items-end gap-1">
        <button className={btnClass} onClick={() => run((a) => a.getSprint(id, sprint.id)).then((d) => d && setDetail(d))}>
          <FileText size={12} />
          {t("integrations.jira.agile.sprints.view", "View")}
        </button>
        <button
          className={btnClass}
          onClick={() =>
            run((a) => a.getSprintIssues(id, sprint.id, undefined, undefined)).then((d) => d && setIssues(d))
          }
        >
          {t("integrations.jira.agile.sprints.issues", "Issues")}
        </button>
      </div>

      {/* Update */}
      <div className="rounded border border-[var(--color-border)] p-2">
        <div className="mb-1 text-[11px] font-semibold text-[var(--color-text)]">
          {t("integrations.jira.agile.sprints.update", "Update sprint")}
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Field label={t("integrations.jira.agile.col.name", "Name")}>
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={t("integrations.jira.agile.col.state", "State")}>
            <select className={inputClass} value={state} onChange={(e) => setState(e.target.value)}>
              <option value="">{t("integrations.jira.agile.sprints.keepState", "Keep")}</option>
              <option value="future">future</option>
              <option value="active">active</option>
              <option value="closed">closed</option>
            </select>
          </Field>
          <Field label={t("integrations.jira.agile.sprints.startDate", "Start date (ISO)")}>
            <input className={inputClass} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </Field>
          <Field label={t("integrations.jira.agile.sprints.endDate", "End date (ISO)")}>
            <input className={inputClass} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </Field>
          <Field label={t("integrations.jira.agile.sprints.goal", "Goal")}>
            <input className={inputClass} value={goal} onChange={(e) => setGoal(e.target.value)} />
          </Field>
        </div>
        <button className={`${btnClass} mt-2`} onClick={() => void saveUpdate()}>
          {t("integrations.jira.agile.save", "Save")}
        </button>
      </div>

      {/* Move issues */}
      <div className="rounded border border-[var(--color-border)] p-2">
        <label className={labelClass}>
          {t("integrations.jira.agile.sprints.moveIssues", "Move issues in (comma-separated keys)")}
        </label>
        <div className="flex gap-1">
          <input className={inputClass} value={moveIssues} onChange={(e) => setMoveIssues(e.target.value)} placeholder="ACME-1, ACME-2" />
          <button
            className={btnClass}
            disabled={!moveIssues.trim()}
            onClick={() =>
              run((a) =>
                a.moveIssuesToSprint(id, sprint.id, {
                  issues: moveIssues
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                }),
              ).then(() => setMoveIssues(""))
            }
          >
            <Send size={12} />
            {t("integrations.jira.agile.sprints.move", "Move")}
          </button>
        </div>
      </div>

      {detail && <JsonView value={detail} />}
      {issues && <IssueList res={issues} />}
    </div>
  );
};

// ─── Dashboards (2) ─────────────────────────────────────────────────────────--

const DashboardsSection: React.FC<{ mgr: JiraAgileManager; id: string }> = ({ mgr, id }) => {
  const { t } = useTranslation();
  const { run, isLoading } = mgr;
  const [dashboards, setDashboards] = useState<JiraDashboard[]>([]);
  const [detail, setDetail] = useState<JiraDashboard | null>(null);

  const reload = useCallback(async () => {
    const res = await run((a) => a.listDashboards(id, undefined, undefined));
    if (res) setDashboards(res.dashboards);
  }, [run, id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <button onClick={() => void reload()} className={btnClass} disabled={isLoading}>
          <RefreshCw size={12} />
          {t("integrations.jira.agile.refresh", "Refresh")}
        </button>
      </div>
      <div className="overflow-x-auto rounded border border-[var(--color-border)]">
        <table className="w-full text-left text-[11px]">
          <thead className="bg-[var(--color-surfaceHover)] text-[var(--color-textSecondary)]">
            <tr>
              <th className="px-2 py-1">{t("integrations.jira.agile.col.id", "Id")}</th>
              <th className="px-2 py-1">{t("integrations.jira.agile.col.name", "Name")}</th>
              <th className="px-2 py-1">{t("integrations.jira.agile.dashboards.owner", "Owner")}</th>
              <th className="px-2 py-1 text-right">{t("integrations.jira.agile.col.actions", "Actions")}</th>
            </tr>
          </thead>
          <tbody>
            {dashboards.length === 0 && (
              <tr>
                <td colSpan={4} className="px-2 py-4 text-center text-[var(--color-textSecondary)]">
                  {t("integrations.jira.agile.dashboards.empty", "No dashboards.")}
                </td>
              </tr>
            )}
            {dashboards.map((d) => (
              <tr key={d.id ?? d.name ?? ""} className="border-t border-[var(--color-border)]">
                <td className="px-2 py-1 font-medium text-[var(--color-text)]">{d.id ?? "—"}</td>
                <td className="px-2 py-1">{d.name ?? "—"}</td>
                <td className="px-2 py-1">{d.owner?.displayName ?? "—"}</td>
                <td className="px-2 py-1">
                  <div className="flex justify-end gap-1">
                    <IconBtn
                      title={t("integrations.jira.agile.dashboards.view", "View")}
                      onClick={() =>
                        d.id && run((a) => a.getDashboard(id, d.id as string)).then((r) => r && setDetail(r))
                      }
                    >
                      <FileText size={12} />
                    </IconBtn>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {detail && <JsonView value={detail} />}
    </div>
  );
};

// ─── Filters (6) ────────────────────────────────────────────────────────────--

const FiltersSection: React.FC<{ mgr: JiraAgileManager; id: string }> = ({ mgr, id }) => {
  const { t } = useTranslation();
  const { run, isLoading } = mgr;
  const [filters, setFilters] = useState<JiraFilter[]>([]);
  const [filterId, setFilterId] = useState("");
  const [detail, setDetail] = useState<JiraFilter | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const loadFavourites = useCallback(async () => {
    const list = await run((a) => a.getFavouriteFilters(id));
    if (list) setFilters(list);
  }, [run, id]);
  const loadMine = useCallback(async () => {
    const list = await run((a) => a.getMyFilters(id));
    if (list) setFilters(list);
  }, [run, id]);

  useEffect(() => {
    void loadFavourites();
  }, [loadFavourites]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <button onClick={() => void loadFavourites()} className={btnClass} disabled={isLoading}>
          <Star size={12} />
          {t("integrations.jira.agile.filters.favourites", "Favourites")}
        </button>
        <button onClick={() => void loadMine()} className={btnClass} disabled={isLoading}>
          {t("integrations.jira.agile.filters.mine", "My filters")}
        </button>
        <div className="w-40">
          <label className={labelClass}>{t("integrations.jira.agile.filters.getById", "Get by id")}</label>
          <div className="flex gap-1">
            <input className={inputClass} value={filterId} onChange={(e) => setFilterId(e.target.value)} />
            <button
              className={btnClass}
              disabled={!filterId.trim()}
              onClick={() => run((a) => a.getFilter(id, filterId.trim())).then((d) => d && setDetail(d))}
            >
              <FileText size={12} />
            </button>
          </div>
        </div>
        <button onClick={() => setShowCreate((s) => !s)} className={primaryBtn}>
          <Plus size={12} />
          {t("integrations.jira.agile.filters.new", "New filter")}
        </button>
      </div>

      {showCreate && (
        <CreateFilterForm
          mgr={mgr}
          id={id}
          onDone={() => {
            setShowCreate(false);
            void loadMine();
          }}
        />
      )}

      <ul className="flex flex-col gap-1">
        {filters.map((f) => (
          <FilterRow key={f.id ?? f.name ?? ""} mgr={mgr} id={id} filter={f} onChanged={loadFavourites} />
        ))}
      </ul>

      {detail && <JsonView value={detail} />}
    </div>
  );
};

const FilterRow: React.FC<{
  mgr: JiraAgileManager;
  id: string;
  filter: JiraFilter;
  onChanged: () => Promise<void>;
}> = ({ mgr, id, filter, onChanged }) => {
  const { t } = useTranslation();
  const { run } = mgr;
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(filter.name ?? "");
  const [jql, setJql] = useState(filter.jql ?? "");
  const [description, setDescription] = useState(filter.description ?? "");
  const [favourite, setFavourite] = useState(Boolean(filter.favourite));

  const fid = filter.id ?? "";

  return (
    <li className="rounded border border-[var(--color-border)]">
      <div className="flex items-center gap-2 px-2 py-1 text-[11px]">
        <button onClick={() => setOpen((o) => !o)} aria-label="toggle">
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        <span className="font-medium text-[var(--color-text)]">{filter.name ?? "—"}</span>
        <span className="truncate text-[var(--color-textSecondary)]">{filter.jql ?? ""}</span>
        <div className="ml-auto flex gap-1">
          <IconBtn
            title={t("integrations.jira.agile.action.delete", "Delete")}
            onClick={() => fid && run((a) => a.deleteFilter(id, fid)).then(onChanged)}
          >
            <Trash2 size={12} />
          </IconBtn>
        </div>
      </div>
      {open && (
        <div className="border-t border-[var(--color-border)] p-2">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Field label={t("integrations.jira.agile.col.name", "Name")}>
              <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label={t("integrations.jira.agile.filters.jql", "JQL")}>
              <input className={inputClass} value={jql} onChange={(e) => setJql(e.target.value)} />
            </Field>
            <Field label={t("integrations.jira.agile.filters.description", "Description")}>
              <input className={inputClass} value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
            <label className="flex items-center gap-2 text-[11px] text-[var(--color-textSecondary)]">
              <input type="checkbox" checked={favourite} onChange={(e) => setFavourite(e.target.checked)} />
              {t("integrations.jira.agile.filters.favourite", "Favourite")}
            </label>
          </div>
          <button
            className={`${btnClass} mt-2`}
            disabled={!fid}
            onClick={() =>
              run((a) =>
                a.updateFilter(id, fid, {
                  name: name.trim() || undefined,
                  jql: jql.trim() || undefined,
                  description: description.trim() || undefined,
                  favourite,
                }),
              ).then(onChanged)
            }
          >
            {t("integrations.jira.agile.save", "Save")}
          </button>
        </div>
      )}
    </li>
  );
};

const CreateFilterForm: React.FC<{
  mgr: JiraAgileManager;
  id: string;
  onDone: () => void;
}> = ({ mgr, id, onDone }) => {
  const { t } = useTranslation();
  const { run, isLoading } = mgr;
  const [name, setName] = useState("");
  const [jql, setJql] = useState("");
  const [description, setDescription] = useState("");
  const [favourite, setFavourite] = useState(false);

  const submit = useCallback(async () => {
    const request: CreateFilterRequest = {
      name: name.trim(),
      jql: jql.trim(),
      description: description.trim() || undefined,
      favourite,
    };
    const created = await run((a) => a.createFilter(id, request));
    if (created) onDone();
  }, [run, id, name, jql, description, favourite, onDone]);

  return (
    <div className="rounded border border-[var(--color-border)] p-2">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Field label={t("integrations.jira.agile.col.name", "Name")}>
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t("integrations.jira.agile.filters.jql", "JQL")}>
          <input className={inputClass} value={jql} onChange={(e) => setJql(e.target.value)} placeholder="assignee = currentUser()" />
        </Field>
        <Field label={t("integrations.jira.agile.filters.description", "Description")}>
          <input className={inputClass} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 text-[11px] text-[var(--color-textSecondary)]">
          <input type="checkbox" checked={favourite} onChange={(e) => setFavourite(e.target.checked)} />
          {t("integrations.jira.agile.filters.favourite", "Favourite")}
        </label>
      </div>
      <div className="mt-2 flex gap-1">
        <button className={primaryBtn} disabled={isLoading || !name.trim() || !jql.trim()} onClick={() => void submit()}>
          {isLoading ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
          {t("integrations.jira.agile.create", "Create")}
        </button>
        <button className={btnClass} onClick={onDone}>
          {t("integrations.jira.agile.cancel", "Cancel")}
        </button>
      </div>
    </div>
  );
};

// ─── Small presentational helpers ──────────────────────────────────────────────

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <label className={labelClass}>{label}</label>
    {children}
  </div>
);

const IconBtn: React.FC<{
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}> = ({ title, onClick, children }) => (
  <button
    title={title}
    onClick={onClick}
    className="rounded border border-[var(--color-border)] p-1 text-[var(--color-textSecondary)] hover:bg-[var(--color-surfaceHover)] hover:text-[var(--color-text)]"
  >
    {children}
  </button>
);

const JsonView: React.FC<{ value: unknown }> = ({ value }) => (
  <pre className="max-h-56 overflow-auto rounded bg-[var(--color-surface)] p-2 text-[10px] text-[var(--color-text)]">
    {JSON.stringify(value, null, 2)}
  </pre>
);

/** Compact issue-key list for board/sprint issue results (JiraSearchResponse). */
const IssueList: React.FC<{ res: JiraSearchResponse }> = ({ res }) => {
  const { t } = useTranslation();
  return (
    <div className="rounded border border-[var(--color-border)] p-2">
      <div className="mb-1 text-[11px] text-[var(--color-textSecondary)]">
        {t("integrations.jira.agile.issues.total", "Total")}: {res.total}
      </div>
      <ul className="flex flex-wrap gap-1">
        {res.issues.map((iss: JiraIssue) => (
          <li
            key={iss.id || iss.key}
            className="rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[10px] text-[var(--color-text)]"
            title={typeof iss.fields?.summary === "string" ? iss.fields.summary : undefined}
          >
            {iss.key}
          </li>
        ))}
      </ul>
    </div>
  );
};

export default JiraAgileTab;
