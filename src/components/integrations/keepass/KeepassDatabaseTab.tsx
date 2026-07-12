// KeepassDatabaseTab — the "Database & Data Model" management tab (t42-keepass-c1).
//
// Binds the full ~47-command `database` category of sorng-keepass: database
// lifecycle, the group tree, entries, per-entry history, and custom icons. The
// shell (KeepassPanel) opens the .kdbx and routes the open database's id here as
// the `dbId` prop; every action below invokes with that id.
//
// The tab is organised into grouped sub-sections (Overview/lifecycle, Groups,
// Entries, History, Icons) via an internal section switcher. Each control maps to
// exactly one command in `keepassDatabaseApi`.

import React, { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Database,
  FolderTree,
  KeyRound,
  History as HistoryIcon,
  Image as ImageIcon,
  RefreshCw,
  Plus,
  Trash2,
  Save,
  Lock,
  Unlock,
  Archive,
  GitMerge,
  Loader2,
} from "lucide-react";
import type { KeepassTabProps } from "./registry";
import { useKeepassDatabase } from "../../../hooks/integration/keepass/useKeepassDatabase";
import type {
  KeePassGroup,
  GroupTreeNode,
  EntrySummary,
  DatabaseFileInfo,
} from "../../../types/keepass";
import type {
  DatabaseStatistics,
  EntryHistoryItem,
  EntryDiff,
  ConflictResolution,
} from "../../../types/keepass/database";

type SectionKey = "overview" | "groups" | "entries" | "history" | "icons";

// ─── Small shared UI atoms ──────────────────────────────────────────────────────

const inputCls =
  "w-full rounded border border-[var(--color-border)] bg-[var(--color-input)] px-2 py-1.5 text-sm text-[var(--color-text)]";
const btnCls =
  "app-bar-button flex items-center gap-1.5 px-2.5 py-1.5 text-xs disabled:opacity-50";
const primaryBtnCls =
  "flex items-center gap-1.5 rounded bg-primary px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="mb-2 block">
      <span className="mb-1 block text-xs font-medium text-[var(--color-textSecondary)]">
        {label}
      </span>
      {children}
    </label>
  );
}

function SectionCard({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-[var(--color-text)]">
        {icon}
        {title}
      </h3>
      {children}
    </div>
  );
}

/** Generic result viewer — renders any command result as pretty JSON so every
 *  bound command surfaces its output without a bespoke view per command. */
function ResultView({ value }: { value: unknown }) {
  const { t } = useTranslation();
  if (value === undefined) return null;
  return (
    <pre
      className="mt-2 max-h-64 overflow-auto rounded border border-[var(--color-border)] bg-[var(--color-input)] p-2 text-xs text-[var(--color-text)]"
      data-testid="keepass-db-result"
    >
      {value === null
        ? t("integrations.keepass.database.done", "Done.")
        : JSON.stringify(value, null, 2)}
    </pre>
  );
}

// ─── Main tab ───────────────────────────────────────────────────────────────────

const KeepassDatabaseTab: React.FC<KeepassTabProps> = ({ dbId }) => {
  const { t } = useTranslation();
  const mgr = useKeepassDatabase(dbId);
  const { api, run, isLoading, error } = mgr;
  const [section, setSection] = useState<SectionKey>("overview");
  // Shared result slot for one-off action output.
  const [result, setResult] = useState<unknown>(undefined);

  const call = useCallback(
    async (op: () => Promise<unknown>) => {
      try {
        setResult(await run(op));
      } catch {
        // error state is set by `run`; result stays as-is.
      }
    },
    [run],
  );

  const sections: { key: SectionKey; label: string; icon: React.ReactNode }[] = [
    {
      key: "overview",
      label: t("integrations.keepass.database.section.overview", "Overview"),
      icon: <Database size={14} />,
    },
    {
      key: "groups",
      label: t("integrations.keepass.database.section.groups", "Groups"),
      icon: <FolderTree size={14} />,
    },
    {
      key: "entries",
      label: t("integrations.keepass.database.section.entries", "Entries"),
      icon: <KeyRound size={14} />,
    },
    {
      key: "history",
      label: t("integrations.keepass.database.section.history", "History"),
      icon: <HistoryIcon size={14} />,
    },
    {
      key: "icons",
      label: t("integrations.keepass.database.section.icons", "Custom icons"),
      icon: <ImageIcon size={14} />,
    },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Section switcher */}
      <div
        className="flex flex-wrap gap-1 border-b border-[var(--color-border)] px-2 py-1"
        role="tablist"
      >
        {sections.map((s) => (
          <button
            key={s.key}
            role="tab"
            aria-selected={section === s.key}
            onClick={() => {
              setSection(s.key);
              setResult(undefined);
            }}
            className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs ${
              section === s.key
                ? "bg-primary/15 text-[var(--color-text)]"
                : "text-[var(--color-textSecondary)]"
            }`}
            data-testid={`keepass-db-section-${s.key}`}
          >
            {s.icon}
            {s.label}
          </button>
        ))}
        {isLoading && (
          <span className="ml-auto flex items-center gap-1 self-center text-xs text-[var(--color-textMuted)]">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          </span>
        )}
      </div>

      {error && (
        <div
          className="mx-3 mt-2 rounded border border-red-500/40 bg-red-500/10 px-2 py-1.5 text-xs text-red-400"
          data-testid="keepass-db-error"
        >
          {error}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {section === "overview" && (
          <OverviewSection mgr={mgr} call={call} />
        )}
        {section === "groups" && <GroupsSection mgr={mgr} call={call} />}
        {section === "entries" && <EntriesSection mgr={mgr} call={call} />}
        {section === "history" && (
          <HistorySection api={api} call={call} dbId={dbId} />
        )}
        {section === "icons" && (
          <IconsSection api={api} call={call} dbId={dbId} />
        )}
        <ResultView value={result} />
      </div>
    </div>
  );
};

type Mgr = ReturnType<typeof useKeepassDatabase>;
type CallFn = (op: () => Promise<unknown>) => Promise<void>;

// ─── Overview / lifecycle (15 commands) ─────────────────────────────────────────

function OverviewSection({ mgr, call }: { mgr: Mgr; call: CallFn }) {
  const { t } = useTranslation();
  const { api, dbId } = mgr;
  const [stats, setStats] = useState<DatabaseStatistics | null>(null);
  const [backups, setBackups] = useState<DatabaseFileInfo[]>([]);
  const [fileInfoPath, setFileInfoPath] = useState("");

  // Update-metadata form.
  const [meta, setMeta] = useState({
    name: "",
    description: "",
    defaultUsername: "",
    color: "",
  });
  const [recycleBinEnabled, setRecycleBinEnabled] = useState(true);

  // Change-master-key form.
  const [mk, setMk] = useState({
    currentPassword: "",
    currentKeyFile: "",
    newPassword: "",
    newKeyFile: "",
  });

  // Unlock form.
  const [unlockPw, setUnlockPw] = useState("");

  // Merge form.
  const [merge, setMerge] = useState<{
    remotePath: string;
    remotePassword: string;
    conflictResolution: ConflictResolution;
  }>({ remotePath: "", remotePassword: "", conflictResolution: "PreferNewer" });

  const loadStats = useCallback(async () => {
    try {
      setStats(await mgr.loadStatistics());
    } catch {
      /* surfaced via mgr.error */
    }
  }, [mgr]);

  const conflictOptions: ConflictResolution[] = [
    "KeepLocal",
    "KeepRemote",
    "PreferNewer",
    "KeepBoth",
    "Manual",
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <SectionCard
        title={t("integrations.keepass.database.overview.statistics", "Statistics")}
        icon={<Database size={14} />}
      >
        <button className={btnCls} onClick={loadStats}>
          <RefreshCw size={13} />
          {t("integrations.keepass.database.overview.loadStats", "Load statistics")}
        </button>
        {stats && (
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
            <Stat label={t("integrations.keepass.database.stat.entries", "Entries")} value={stats.totalEntries} />
            <Stat label={t("integrations.keepass.database.stat.groups", "Groups")} value={stats.totalGroups} />
            <Stat label={t("integrations.keepass.database.stat.attachments", "Attachments")} value={stats.totalAttachments} />
            <Stat label={t("integrations.keepass.database.stat.customIcons", "Custom icons")} value={stats.totalCustomIcons} />
            <Stat label={t("integrations.keepass.database.stat.expired", "Expired")} value={stats.expiredEntries} />
            <Stat label={t("integrations.keepass.database.stat.weak", "Weak passwords")} value={stats.entriesWithWeakPassword} />
            <Stat label={t("integrations.keepass.database.stat.reused", "Reused")} value={stats.entriesWithDuplicatePassword} />
            <Stat label={t("integrations.keepass.database.stat.otp", "With OTP")} value={stats.entriesWithOtp} />
          </div>
        )}
      </SectionCard>

      <SectionCard
        title={t("integrations.keepass.database.overview.lifecycle", "Lifecycle")}
        icon={<Save size={14} />}
      >
        <div className="flex flex-wrap gap-1.5">
          <button className={btnCls} onClick={() => call(() => api.saveDatabase(dbId))}>
            <Save size={13} />
            {t("integrations.keepass.database.overview.save", "Save")}
          </button>
          <button className={btnCls} onClick={() => call(() => api.lockDatabase(dbId))}>
            <Lock size={13} />
            {t("integrations.keepass.database.overview.lock", "Lock")}
          </button>
          <button
            className={btnCls}
            onClick={() => call(() => api.unlockDatabase(dbId, unlockPw || undefined))}
          >
            <Unlock size={13} />
            {t("integrations.keepass.database.overview.unlock", "Unlock")}
          </button>
          <button
            className={btnCls}
            onClick={() =>
              call(async () => {
                const list = await api.listBackups(dbId);
                setBackups(list);
                return list;
              })
            }
          >
            <Archive size={13} />
            {t("integrations.keepass.database.overview.listBackups", "List backups")}
          </button>
          <button className={btnCls} onClick={() => call(() => api.backupDatabase(dbId))}>
            <Archive size={13} />
            {t("integrations.keepass.database.overview.backup", "Backup")}
          </button>
          <button className={btnCls} onClick={() => call(() => api.listDatabases())}>
            <Database size={13} />
            {t("integrations.keepass.database.overview.listDatabases", "List open DBs")}
          </button>
          <button className={btnCls} onClick={() => call(() => api.closeDatabase(dbId, true))}>
            <Lock size={13} />
            {t("integrations.keepass.database.overview.close", "Save & close")}
          </button>
          <button className={btnCls} onClick={() => call(() => api.closeAllDatabases(true))}>
            <Lock size={13} />
            {t("integrations.keepass.database.overview.closeAll", "Close all")}
          </button>
        </div>
        <Field label={t("integrations.keepass.database.overview.unlockPassword", "Unlock password")}>
          <input
            type="password"
            className={inputCls}
            value={unlockPw}
            onChange={(e) => setUnlockPw(e.target.value)}
          />
        </Field>
        {backups.length > 0 && (
          <ul className="mt-1 max-h-32 overflow-auto text-xs text-[var(--color-textSecondary)]">
            {backups.map((b) => (
              <li key={b.filePath} className="truncate">
                {b.filePath} · {b.fileSize} B
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard
        title={t("integrations.keepass.database.overview.metadata", "Update metadata")}
      >
        <Field label={t("integrations.keepass.database.field.name", "Name")}>
          <input className={inputCls} value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value })} />
        </Field>
        <Field label={t("integrations.keepass.database.field.description", "Description")}>
          <input className={inputCls} value={meta.description} onChange={(e) => setMeta({ ...meta, description: e.target.value })} />
        </Field>
        <Field label={t("integrations.keepass.database.field.defaultUsername", "Default username")}>
          <input className={inputCls} value={meta.defaultUsername} onChange={(e) => setMeta({ ...meta, defaultUsername: e.target.value })} />
        </Field>
        <Field label={t("integrations.keepass.database.field.color", "Color")}>
          <input className={inputCls} value={meta.color} onChange={(e) => setMeta({ ...meta, color: e.target.value })} />
        </Field>
        <label className="mb-2 flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
          <input type="checkbox" checked={recycleBinEnabled} onChange={(e) => setRecycleBinEnabled(e.target.checked)} />
          {t("integrations.keepass.database.field.recycleBin", "Recycle bin enabled")}
        </label>
        <button
          className={primaryBtnCls}
          onClick={() =>
            call(() =>
              api.updateDatabaseMetadata(dbId, {
                name: meta.name || undefined,
                description: meta.description || undefined,
                defaultUsername: meta.defaultUsername || undefined,
                color: meta.color || undefined,
                recycleBinEnabled,
              }),
            )
          }
        >
          {t("integrations.keepass.database.overview.updateMetadata", "Update metadata")}
        </button>
      </SectionCard>

      <SectionCard
        title={t("integrations.keepass.database.overview.changeKey", "Change master key")}
        icon={<KeyRound size={14} />}
      >
        <Field label={t("integrations.keepass.database.field.currentPassword", "Current password")}>
          <input type="password" className={inputCls} value={mk.currentPassword} onChange={(e) => setMk({ ...mk, currentPassword: e.target.value })} />
        </Field>
        <Field label={t("integrations.keepass.database.field.currentKeyFile", "Current key file")}>
          <input className={inputCls} value={mk.currentKeyFile} onChange={(e) => setMk({ ...mk, currentKeyFile: e.target.value })} />
        </Field>
        <Field label={t("integrations.keepass.database.field.newPassword", "New password")}>
          <input type="password" className={inputCls} value={mk.newPassword} onChange={(e) => setMk({ ...mk, newPassword: e.target.value })} />
        </Field>
        <Field label={t("integrations.keepass.database.field.newKeyFile", "New key file")}>
          <input className={inputCls} value={mk.newKeyFile} onChange={(e) => setMk({ ...mk, newKeyFile: e.target.value })} />
        </Field>
        <button
          className={primaryBtnCls}
          onClick={() =>
            call(() =>
              api.changeMasterKey(
                dbId,
                mk.currentPassword || undefined,
                mk.currentKeyFile || undefined,
                mk.newPassword || undefined,
                mk.newKeyFile || undefined,
              ),
            )
          }
        >
          {t("integrations.keepass.database.overview.changeKey", "Change master key")}
        </button>
      </SectionCard>

      <SectionCard
        title={t("integrations.keepass.database.overview.merge", "Merge / sync")}
        icon={<GitMerge size={14} />}
      >
        <Field label={t("integrations.keepass.database.field.remotePath", "Remote .kdbx path")}>
          <input className={inputCls} value={merge.remotePath} onChange={(e) => setMerge({ ...merge, remotePath: e.target.value })} />
        </Field>
        <Field label={t("integrations.keepass.database.field.remotePassword", "Remote password")}>
          <input type="password" className={inputCls} value={merge.remotePassword} onChange={(e) => setMerge({ ...merge, remotePassword: e.target.value })} />
        </Field>
        <Field label={t("integrations.keepass.database.field.conflict", "Conflict resolution")}>
          <select
            className={inputCls}
            value={merge.conflictResolution}
            onChange={(e) => setMerge({ ...merge, conflictResolution: e.target.value as ConflictResolution })}
          >
            {conflictOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
        <button
          className={primaryBtnCls}
          disabled={!merge.remotePath}
          onClick={() =>
            call(() =>
              api.mergeDatabase(
                dbId,
                {
                  remotePath: merge.remotePath,
                  remotePassword: merge.remotePassword || undefined,
                  conflictResolution: merge.conflictResolution,
                  syncDeletions: false,
                  mergeCustomIcons: true,
                },
                merge.remotePath,
              ),
            )
          }
        >
          <GitMerge size={14} />
          {t("integrations.keepass.database.overview.merge", "Merge")}
        </button>
      </SectionCard>

      <SectionCard
        title={t("integrations.keepass.database.overview.fileInfo", "File info (on disk)")}
      >
        <div className="flex gap-2">
          <input
            className={inputCls}
            placeholder={t("integrations.keepass.database.field.filePath", "/path/to/file.kdbx")}
            value={fileInfoPath}
            onChange={(e) => setFileInfoPath(e.target.value)}
          />
          <button
            className={btnCls}
            disabled={!fileInfoPath}
            onClick={() => call(() => api.getDatabaseFileInfo(fileInfoPath))}
          >
            {t("integrations.keepass.database.overview.inspect", "Inspect")}
          </button>
        </div>
      </SectionCard>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-[var(--color-border)] bg-[var(--color-input)] px-2 py-1.5">
      <div className="text-[var(--color-textMuted)]">{label}</div>
      <div className="text-sm font-semibold text-[var(--color-text)]">{value}</div>
    </div>
  );
}

// ─── Groups (12 commands) ───────────────────────────────────────────────────────

function GroupsSection({ mgr, call }: { mgr: Mgr; call: CallFn }) {
  const { t } = useTranslation();
  const { api, dbId } = mgr;
  const [groups, setGroups] = useState<KeePassGroup[]>([]);
  const [tree, setTree] = useState<GroupTreeNode | null>(null);
  const [selected, setSelected] = useState<string>("");
  const [form, setForm] = useState({ name: "", parentUuid: "", notes: "" });
  const [moveTarget, setMoveTarget] = useState("");

  const refresh = useCallback(async () => {
    try {
      setGroups(await mgr.loadGroups());
    } catch {
      /* surfaced via mgr.error */
    }
  }, [mgr]);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <SectionCard title={t("integrations.keepass.database.groups.list", "Group list")} icon={<FolderTree size={14} />}>
        <div className="mb-2 flex flex-wrap gap-1.5">
          <button className={btnCls} onClick={refresh}>
            <RefreshCw size={13} />
            {t("integrations.keepass.database.refresh", "Refresh")}
          </button>
          <button
            className={btnCls}
            onClick={() =>
              call(async () => {
                const tr = await mgr.loadGroupTree();
                setTree(tr);
                return tr;
              })
            }
          >
            <FolderTree size={13} />
            {t("integrations.keepass.database.groups.tree", "Group tree")}
          </button>
        </div>
        <ul className="max-h-64 overflow-auto text-xs">
          {groups.map((g) => (
            <li key={g.uuid}>
              <button
                onClick={() => setSelected(g.uuid)}
                className={`w-full truncate rounded px-2 py-1 text-left ${
                  selected === g.uuid ? "bg-primary/15 text-[var(--color-text)]" : "text-[var(--color-textSecondary)]"
                }`}
              >
                {g.name} · {g.entryCount}
              </button>
            </li>
          ))}
        </ul>
        {tree && (
          <div className="mt-1 text-xs text-[var(--color-textMuted)]">
            {t("integrations.keepass.database.groups.treeRoot", "Root")}: {tree.name} ({tree.children.length})
          </div>
        )}
      </SectionCard>

      <SectionCard title={t("integrations.keepass.database.groups.create", "Create group")} icon={<Plus size={14} />}>
        <Field label={t("integrations.keepass.database.field.name", "Name")}>
          <input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label={t("integrations.keepass.database.groups.parent", "Parent UUID (blank = root)")}>
          <input className={inputCls} value={form.parentUuid} onChange={(e) => setForm({ ...form, parentUuid: e.target.value })} />
        </Field>
        <Field label={t("integrations.keepass.database.field.notes", "Notes")}>
          <input className={inputCls} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </Field>
        <button
          className={primaryBtnCls}
          disabled={!form.name}
          onClick={() =>
            call(() =>
              api.createGroup(dbId, {
                name: form.name,
                parentUuid: form.parentUuid || undefined,
                notes: form.notes || undefined,
              }),
            )
          }
        >
          <Plus size={14} />
          {t("integrations.keepass.database.groups.create", "Create group")}
        </button>
      </SectionCard>

      <SectionCard title={t("integrations.keepass.database.groups.selected", "Selected group actions")}>
        <Field label={t("integrations.keepass.database.groups.uuid", "Group UUID")}>
          <input className={inputCls} value={selected} onChange={(e) => setSelected(e.target.value)} />
        </Field>
        <div className="flex flex-wrap gap-1.5">
          <button className={btnCls} disabled={!selected} onClick={() => call(() => api.getGroup(dbId, selected))}>
            {t("integrations.keepass.database.groups.get", "Get")}
          </button>
          <button className={btnCls} disabled={!selected} onClick={() => call(() => api.getGroupPath(dbId, selected))}>
            {t("integrations.keepass.database.groups.path", "Path")}
          </button>
          <button className={btnCls} disabled={!selected} onClick={() => call(() => api.listChildGroups(dbId, selected))}>
            {t("integrations.keepass.database.groups.children", "Child groups")}
          </button>
          <button className={btnCls} disabled={!selected} onClick={() => call(() => api.sortGroups(dbId, selected))}>
            {t("integrations.keepass.database.groups.sort", "Sort children")}
          </button>
          <button className={btnCls} disabled={!selected} onClick={() => call(() => api.groupEntryCount(dbId, selected, true))}>
            {t("integrations.keepass.database.groups.count", "Entry count")}
          </button>
          <button className={btnCls} disabled={!selected} onClick={() => call(() => api.groupTags(dbId, selected))}>
            {t("integrations.keepass.database.groups.tags", "Tags")}
          </button>
          <button
            className={btnCls}
            disabled={!selected}
            onClick={() => call(() => api.updateGroup(dbId, selected, { name: form.name || "Group", notes: form.notes || undefined }))}
          >
            {t("integrations.keepass.database.update", "Update")}
          </button>
          <button
            className={btnCls}
            disabled={!selected}
            onClick={() => call(() => api.deleteGroup(dbId, selected, false))}
          >
            <Trash2 size={13} />
            {t("integrations.keepass.database.groups.recycle", "Recycle")}
          </button>
          <button
            className={btnCls}
            disabled={!selected}
            onClick={() => call(() => api.deleteGroup(dbId, selected, true))}
          >
            <Trash2 size={13} />
            {t("integrations.keepass.database.groups.deletePermanent", "Delete permanently")}
          </button>
        </div>
        <div className="mt-2 flex gap-2">
          <input
            className={inputCls}
            placeholder={t("integrations.keepass.database.groups.newParent", "New parent UUID")}
            value={moveTarget}
            onChange={(e) => setMoveTarget(e.target.value)}
          />
          <button
            className={btnCls}
            disabled={!selected || !moveTarget}
            onClick={() => call(() => api.moveGroup(dbId, selected, moveTarget))}
          >
            {t("integrations.keepass.database.groups.move", "Move")}
          </button>
        </div>
      </SectionCard>
    </div>
  );
}

// ─── Entries (11 commands) ──────────────────────────────────────────────────────

function EntriesSection({ mgr, call }: { mgr: Mgr; call: CallFn }) {
  const { t } = useTranslation();
  const { api, dbId } = mgr;
  const [entries, setEntries] = useState<EntrySummary[]>([]);
  const [groupUuid, setGroupUuid] = useState("");
  const [selected, setSelected] = useState("");
  const [moveTarget, setMoveTarget] = useState("");
  const [form, setForm] = useState({
    groupUuid: "",
    title: "",
    username: "",
    password: "",
    url: "",
    notes: "",
  });

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <SectionCard title={t("integrations.keepass.database.entries.list", "Entry list")} icon={<KeyRound size={14} />}>
        <div className="mb-2 flex flex-wrap gap-1.5">
          <button
            className={btnCls}
            onClick={() =>
              call(async () => {
                const list = await mgr.loadAllEntries();
                setEntries(list);
                return list;
              })
            }
          >
            <RefreshCw size={13} />
            {t("integrations.keepass.database.entries.all", "All entries")}
          </button>
          <button
            className={btnCls}
            disabled={!groupUuid}
            onClick={() =>
              call(async () => {
                const list = await mgr.loadEntriesInGroup(groupUuid);
                setEntries(list);
                return list;
              })
            }
          >
            {t("integrations.keepass.database.entries.inGroup", "In group")}
          </button>
          <button
            className={btnCls}
            disabled={!groupUuid}
            onClick={() =>
              call(async () => {
                const list = await api.listEntriesRecursive(dbId, groupUuid);
                setEntries(list);
                return list;
              })
            }
          >
            {t("integrations.keepass.database.entries.recursive", "Recursive")}
          </button>
          <button className={btnCls} onClick={() => call(() => api.emptyRecycleBin(dbId))}>
            <Trash2 size={13} />
            {t("integrations.keepass.database.entries.emptyRecycle", "Empty recycle bin")}
          </button>
        </div>
        <Field label={t("integrations.keepass.database.entries.groupFilter", "Group UUID filter")}>
          <input className={inputCls} value={groupUuid} onChange={(e) => setGroupUuid(e.target.value)} />
        </Field>
        <ul className="max-h-56 overflow-auto text-xs">
          {entries.map((en) => (
            <li key={en.uuid}>
              <button
                onClick={() => setSelected(en.uuid)}
                className={`w-full truncate rounded px-2 py-1 text-left ${
                  selected === en.uuid ? "bg-primary/15 text-[var(--color-text)]" : "text-[var(--color-textSecondary)]"
                }`}
              >
                {en.title || "(untitled)"} · {en.username}
              </button>
            </li>
          ))}
        </ul>
      </SectionCard>

      <SectionCard title={t("integrations.keepass.database.entries.create", "Create entry")} icon={<Plus size={14} />}>
        <Field label={t("integrations.keepass.database.entries.group", "Group UUID")}>
          <input className={inputCls} value={form.groupUuid} onChange={(e) => setForm({ ...form, groupUuid: e.target.value })} />
        </Field>
        <Field label={t("integrations.keepass.database.entries.title", "Title")}>
          <input className={inputCls} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </Field>
        <Field label={t("integrations.keepass.database.entries.username", "Username")}>
          <input className={inputCls} value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
        </Field>
        <Field label={t("integrations.keepass.database.entries.password", "Password")}>
          <input type="password" className={inputCls} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </Field>
        <Field label={t("integrations.keepass.database.entries.url", "URL")}>
          <input className={inputCls} value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
        </Field>
        <Field label={t("integrations.keepass.database.field.notes", "Notes")}>
          <input className={inputCls} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </Field>
        <button
          className={primaryBtnCls}
          disabled={!form.groupUuid}
          onClick={() =>
            call(() =>
              api.createEntry(dbId, {
                groupUuid: form.groupUuid,
                title: form.title || undefined,
                username: form.username || undefined,
                password: form.password || undefined,
                url: form.url || undefined,
                notes: form.notes || undefined,
              }),
            )
          }
        >
          <Plus size={14} />
          {t("integrations.keepass.database.entries.create", "Create entry")}
        </button>
      </SectionCard>

      <SectionCard title={t("integrations.keepass.database.entries.selected", "Selected entry actions")}>
        <Field label={t("integrations.keepass.database.entries.uuid", "Entry UUID")}>
          <input className={inputCls} value={selected} onChange={(e) => setSelected(e.target.value)} />
        </Field>
        <div className="flex flex-wrap gap-1.5">
          <button className={btnCls} disabled={!selected} onClick={() => call(() => api.getEntry(dbId, selected))}>
            {t("integrations.keepass.database.entries.get", "Get")}
          </button>
          <button
            className={btnCls}
            disabled={!selected}
            onClick={() => call(() => api.updateEntry(dbId, selected, { groupUuid: form.groupUuid || groupUuid, title: form.title || undefined }))}
          >
            {t("integrations.keepass.database.update", "Update")}
          </button>
          <button className={btnCls} disabled={!selected} onClick={() => call(() => api.deleteEntry(dbId, selected, false))}>
            <Trash2 size={13} />
            {t("integrations.keepass.database.entries.recycle", "Recycle")}
          </button>
          <button className={btnCls} disabled={!selected} onClick={() => call(() => api.deleteEntry(dbId, selected, true))}>
            <Trash2 size={13} />
            {t("integrations.keepass.database.entries.deletePermanent", "Delete permanently")}
          </button>
          <button className={btnCls} disabled={!selected} onClick={() => call(() => api.restoreEntry(dbId, selected))}>
            {t("integrations.keepass.database.entries.restore", "Restore")}
          </button>
        </div>
        <div className="mt-2 flex gap-2">
          <input
            className={inputCls}
            placeholder={t("integrations.keepass.database.entries.targetGroup", "Target group UUID")}
            value={moveTarget}
            onChange={(e) => setMoveTarget(e.target.value)}
          />
          <button className={btnCls} disabled={!selected || !moveTarget} onClick={() => call(() => api.moveEntry(dbId, selected, moveTarget))}>
            {t("integrations.keepass.database.groups.move", "Move")}
          </button>
          <button className={btnCls} disabled={!selected || !moveTarget} onClick={() => call(() => api.copyEntry(dbId, selected, moveTarget))}>
            {t("integrations.keepass.database.entries.copy", "Copy")}
          </button>
        </div>
      </SectionCard>
    </div>
  );
}

// ─── Entry history (5 commands) ─────────────────────────────────────────────────

function HistorySection({
  api,
  call,
  dbId,
}: {
  api: Mgr["api"];
  call: CallFn;
  dbId: string;
}) {
  const { t } = useTranslation();
  const [entryUuid, setEntryUuid] = useState("");
  const [history, setHistory] = useState<EntryHistoryItem[]>([]);
  const [index, setIndex] = useState(0);
  const [diff, setDiff] = useState<EntryDiff | null>(null);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <SectionCard title={t("integrations.keepass.database.history.title", "Entry history")} icon={<HistoryIcon size={14} />}>
        <Field label={t("integrations.keepass.database.entries.uuid", "Entry UUID")}>
          <input className={inputCls} value={entryUuid} onChange={(e) => setEntryUuid(e.target.value)} />
        </Field>
        <div className="flex flex-wrap gap-1.5">
          <button
            className={btnCls}
            disabled={!entryUuid}
            onClick={() =>
              call(async () => {
                const h = await api.getEntryHistory(dbId, entryUuid);
                setHistory(h);
                return h;
              })
            }
          >
            <RefreshCw size={13} />
            {t("integrations.keepass.database.history.load", "Load history")}
          </button>
          <button className={btnCls} disabled={!entryUuid} onClick={() => call(() => api.deleteEntryHistory(dbId, entryUuid))}>
            <Trash2 size={13} />
            {t("integrations.keepass.database.history.deleteAll", "Delete all history")}
          </button>
        </div>
        <ul className="mt-2 max-h-56 overflow-auto text-xs">
          {history.map((h) => (
            <li key={h.index}>
              <button
                onClick={() => setIndex(h.index)}
                className={`w-full truncate rounded px-2 py-1 text-left ${
                  index === h.index ? "bg-primary/15 text-[var(--color-text)]" : "text-[var(--color-textSecondary)]"
                }`}
              >
                #{h.index} · {h.modifiedAt}
              </button>
            </li>
          ))}
        </ul>
      </SectionCard>

      <SectionCard title={t("integrations.keepass.database.history.snapshot", "Snapshot actions")}>
        <Field label={t("integrations.keepass.database.history.index", "History index")}>
          <input
            type="number"
            className={inputCls}
            value={index}
            onChange={(e) => setIndex(Number(e.target.value))}
          />
        </Field>
        <div className="flex flex-wrap gap-1.5">
          <button className={btnCls} disabled={!entryUuid} onClick={() => call(() => api.getEntryHistoryItem(dbId, entryUuid, index))}>
            {t("integrations.keepass.database.history.getItem", "Get snapshot")}
          </button>
          <button className={btnCls} disabled={!entryUuid} onClick={() => call(() => api.restoreEntryFromHistory(dbId, entryUuid, index))}>
            {t("integrations.keepass.database.history.restore", "Restore snapshot")}
          </button>
          <button
            className={btnCls}
            disabled={!entryUuid}
            onClick={() =>
              call(async () => {
                const d = await api.diffEntryWithHistory(dbId, entryUuid, index);
                setDiff(d);
                return d;
              })
            }
          >
            {t("integrations.keepass.database.history.diff", "Diff vs current")}
          </button>
        </div>
        {diff && (
          <div className="mt-2 text-xs text-[var(--color-textSecondary)]">
            {t("integrations.keepass.database.history.changedFields", "Changed fields")}: {diff.changedFields.length}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

// ─── Custom icons (4 commands) ──────────────────────────────────────────────────

function IconsSection({
  api,
  call,
  dbId,
}: {
  api: Mgr["api"];
  call: CallFn;
  dbId: string;
}) {
  const { t } = useTranslation();
  const [icons, setIcons] = useState<string[]>([]);
  const [selected, setSelected] = useState("");
  const [base64, setBase64] = useState("");

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <SectionCard title={t("integrations.keepass.database.icons.list", "Custom icons")} icon={<ImageIcon size={14} />}>
        <button
          className={btnCls}
          onClick={() =>
            call(async () => {
              const list = await api.listCustomIcons(dbId);
              setIcons(list);
              return list;
            })
          }
        >
          <RefreshCw size={13} />
          {t("integrations.keepass.database.refresh", "Refresh")}
        </button>
        <ul className="mt-2 max-h-56 overflow-auto text-xs">
          {icons.map((uuid) => (
            <li key={uuid}>
              <button
                onClick={() => setSelected(uuid)}
                className={`w-full truncate rounded px-2 py-1 text-left font-mono ${
                  selected === uuid ? "bg-primary/15 text-[var(--color-text)]" : "text-[var(--color-textSecondary)]"
                }`}
              >
                {uuid}
              </button>
            </li>
          ))}
        </ul>
      </SectionCard>

      <SectionCard title={t("integrations.keepass.database.icons.manage", "Add / manage")}>
        <Field label={t("integrations.keepass.database.icons.base64", "Icon data (base64 PNG)")}>
          <textarea
            className={`${inputCls} h-20 font-mono`}
            value={base64}
            onChange={(e) => setBase64(e.target.value)}
          />
        </Field>
        <div className="flex flex-wrap gap-1.5">
          <button className={btnCls} disabled={!base64} onClick={() => call(() => api.addCustomIcon(dbId, base64))}>
            <Plus size={13} />
            {t("integrations.keepass.database.icons.add", "Add icon")}
          </button>
        </div>
        <Field label={t("integrations.keepass.database.icons.uuid", "Icon UUID")}>
          <input className={inputCls} value={selected} onChange={(e) => setSelected(e.target.value)} />
        </Field>
        <div className="flex flex-wrap gap-1.5">
          <button className={btnCls} disabled={!selected} onClick={() => call(() => api.getCustomIcon(dbId, selected))}>
            {t("integrations.keepass.database.icons.get", "Get data")}
          </button>
          <button className={btnCls} disabled={!selected} onClick={() => call(() => api.deleteCustomIcon(dbId, selected))}>
            <Trash2 size={13} />
            {t("integrations.keepass.database.icons.delete", "Delete")}
          </button>
        </div>
      </SectionCard>
    </div>
  );
}

export default KeepassDatabaseTab;
