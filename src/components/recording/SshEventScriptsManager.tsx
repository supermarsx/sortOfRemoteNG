import React, { useState, useCallback } from "react";
import { useSshScripts } from "../../hooks/recording/useSshScripts";
import {
  TRIGGER_TYPES,
  SCRIPT_LANGUAGES,
  EXECUTION_MODES,
} from "../../types/sshScripts";
import type {
  SshEventScript,
  ScriptChain,
  CreateScriptRequest,
  ScriptTrigger,
  ScriptLanguage,
  ExecutionMode,
  ExecutionRecord,
  PendingExecution,
  SchedulerEntry,
} from "../../types/sshScripts";

/* ────────────────────────────────────────────────────────────────────────── */
/*  SshEventScriptsManager — comprehensive SSH script management UI          */
/* ────────────────────────────────────────────────────────────────────────── */

interface Props {
  isOpen: boolean;
  onClose: () => void;
  sessionId?: string;
  connectionId?: string;
}

export const SshEventScriptsManager: React.FC<Props> = ({
  isOpen,
  onClose,
  sessionId,
  connectionId,
}) => {
  const hook = useSshScripts();
  const {
    scripts,
    chains,
    selectedScript,
    summary,
    tags,
    categories,
    history,
    historyTotal,
    timers,
    stats,
    loading,
    error,
    searchFilter,
    setSearchFilter,
    triggerFilter,
    setTriggerFilter,
    categoryFilter,
    setCategoryFilter,
    tagFilter,
    setTagFilter,
    tab,
    setTab,
    selectScript,
    createScript,
    updateScript,
    deleteScript,
    duplicateScript,
    toggleScript,
    runScript,
    queryHistory,
    clearHistory,
    exportScripts,
    importScripts,
    bulkEnable,
    bulkDelete,
    refresh,
  } = hook;

  const [showCreate, setShowCreate] = useState(false);
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="flex h-[90vh] w-[95vw] max-w-[1600px] flex-col rounded-xl border border-neutral-700 bg-neutral-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-700 px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="text-xl">⚡</span>
            <h2 className="text-lg font-semibold text-white">
              SSH Event Scripts
            </h2>
            {summary && (
              <span className="rounded-full bg-neutral-700 px-2 py-0.5 text-xs text-neutral-300">
                {summary.totalScripts} scripts · {summary.enabledScripts}{" "}
                enabled · {summary.totalChains} chains
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => exportScripts()}
              className="rounded-lg border border-neutral-600 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800"
              title="Export all scripts"
            >
              📤 Export
            </button>
            <button
              onClick={refresh}
              className="rounded-lg border border-neutral-600 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800"
              title="Refresh"
            >
              🔄
            </button>
            <button
              onClick={onClose}
              className="rounded-lg px-3 py-1.5 text-sm text-neutral-400 hover:bg-neutral-800 hover:text-white"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-neutral-700">
          {(
            [
              { key: "scripts", label: "Scripts", icon: "📜" },
              { key: "chains", label: "Chains", icon: "🔗" },
              { key: "history", label: "History", icon: "📊" },
              { key: "timers", label: "Timers", icon: "⏱️" },
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-5 py-2.5 text-sm font-medium transition-colors ${
                tab === t.key
                  ? "border-b-2 border-blue-500 text-blue-400"
                  : "text-neutral-400 hover:text-neutral-200"
              }`}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {/* Error banner */}
        {error && (
          <div className="mx-6 mt-3 rounded-lg border border-red-800 bg-red-900/30 px-4 py-2 text-sm text-red-300">
            {error}
          </div>
        )}

        {/* Body */}
        <div className="flex flex-1 overflow-hidden">
          {tab === "scripts" && (
            <ScriptsTab
              scripts={scripts}
              selectedScript={selectedScript}
              searchFilter={searchFilter}
              setSearchFilter={setSearchFilter}
              triggerFilter={triggerFilter}
              setTriggerFilter={setTriggerFilter}
              categoryFilter={categoryFilter}
              setCategoryFilter={setCategoryFilter}
              tagFilter={tagFilter}
              setTagFilter={setTagFilter}
              categories={categories}
              tags={tags}
              stats={stats}
              bulkSelected={bulkSelected}
              setBulkSelected={setBulkSelected}
              selectScript={selectScript}
              toggleScript={toggleScript}
              deleteScript={deleteScript}
              duplicateScript={duplicateScript}
              runScript={runScript}
              createScript={createScript}
              updateScript={updateScript}
              bulkEnable={bulkEnable}
              bulkDelete={bulkDelete}
              showCreate={showCreate}
              setShowCreate={setShowCreate}
              confirmDelete={confirmDelete}
              setConfirmDelete={setConfirmDelete}
              sessionId={sessionId}
              connectionId={connectionId}
              loading={loading}
            />
          )}
          {tab === "chains" && (
            <ChainsTab chains={chains} scripts={scripts} />
          )}
          {tab === "history" && (
            <HistoryTab
              history={history}
              historyTotal={historyTotal}
              queryHistory={queryHistory}
              clearHistory={clearHistory}
            />
          )}
          {tab === "timers" && <TimersTab timers={timers} />}
        </div>
      </div>
    </div>
  );
};

/* ══════════════════════════════════════════════════════════════════════════ */
/*  Scripts Tab                                                             */
/* ══════════════════════════════════════════════════════════════════════════ */

interface ScriptsTabProps {
  scripts: SshEventScript[];
  selectedScript: SshEventScript | null;
  searchFilter: string;
  setSearchFilter: (v: string) => void;
  triggerFilter: string;
  setTriggerFilter: (v: string) => void;
  categoryFilter: string;
  setCategoryFilter: (v: string) => void;
  tagFilter: string;
  setTagFilter: (v: string) => void;
  categories: string[];
  tags: string[];
  stats: Record<string, import("../../types/sshScripts").ScriptStats>;
  bulkSelected: Set<string>;
  setBulkSelected: React.Dispatch<React.SetStateAction<Set<string>>>;
  selectScript: (s: SshEventScript | null) => void;
  toggleScript: (id: string, enabled: boolean) => Promise<void>;
  deleteScript: (id: string) => Promise<void>;
  duplicateScript: (id: string) => Promise<SshEventScript>;
  runScript: (req: import("../../types/sshScripts").RunScriptRequest) => Promise<PendingExecution>;
  createScript: (req: CreateScriptRequest) => Promise<SshEventScript>;
  updateScript: (id: string, req: import("../../types/sshScripts").UpdateScriptRequest) => Promise<SshEventScript>;
  bulkEnable: (ids: string[], enabled: boolean) => Promise<number>;
  bulkDelete: (ids: string[]) => Promise<number>;
  showCreate: boolean;
  setShowCreate: (v: boolean) => void;
  confirmDelete: string | null;
  setConfirmDelete: (v: string | null) => void;
  sessionId?: string;
  connectionId?: string;
  loading: boolean;
}

const ScriptsTab: React.FC<ScriptsTabProps> = ({
  scripts,
  selectedScript,
  searchFilter,
  setSearchFilter,
  triggerFilter,
  setTriggerFilter,
  categoryFilter,
  setCategoryFilter,
  tagFilter,
  setTagFilter,
  categories,
  tags,
  stats,
  bulkSelected,
  setBulkSelected,
  selectScript,
  toggleScript,
  deleteScript,
  duplicateScript,
  runScript,
  createScript,
  showCreate,
  setShowCreate,
  confirmDelete,
  setConfirmDelete,
  sessionId,
  connectionId,
  loading,
}) => {
  const toggleBulk = (id: string) => {
    setBulkSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <>
      {/* Left panel — script list */}
      <div className="flex w-[380px] flex-col border-r border-neutral-700">
        {/* Toolbar */}
        <div className="space-y-2 border-b border-neutral-700 px-3 py-3">
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Search scripts…"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              className="flex-1 rounded-lg border border-neutral-600 bg-neutral-800 px-3 py-1.5 text-sm text-white placeholder-neutral-500 focus:border-blue-500 focus:outline-none"
            />
            <button
              onClick={() => setShowCreate(true)}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500"
            >
              + New
            </button>
          </div>
          <div className="flex gap-2">
            <select
              value={triggerFilter}
              onChange={(e) => setTriggerFilter(e.target.value)}
              className="flex-1 rounded border border-neutral-600 bg-neutral-800 px-2 py-1 text-xs text-neutral-300"
            >
              <option value="">All Triggers</option>
              {TRIGGER_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="flex-1 rounded border border-neutral-600 bg-neutral-800 px-2 py-1 text-xs text-neutral-300"
            >
              <option value="">All Categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          {bulkSelected.size > 0 && (
            <div className="flex items-center gap-2 text-xs text-neutral-400">
              <span>{bulkSelected.size} selected</span>
              <button
                onClick={() => {
                  const ids = [...bulkSelected];
                  setBulkSelected(new Set());
                  // eslint-disable-next-line @typescript-eslint/no-floating-promises
                  void Promise.all(ids.map((id) => deleteScript(id)));
                }}
                className="text-red-400 hover:text-red-300"
              >
                Delete
              </button>
              <button
                onClick={() => {
                  const ids = [...bulkSelected];
                  setBulkSelected(new Set());
                  // eslint-disable-next-line @typescript-eslint/no-floating-promises
                  void Promise.all(
                    ids.map((id) => toggleScript(id, true)),
                  );
                }}
                className="text-green-400 hover:text-green-300"
              >
                Enable
              </button>
              <button
                onClick={() => {
                  const ids = [...bulkSelected];
                  setBulkSelected(new Set());
                  // eslint-disable-next-line @typescript-eslint/no-floating-promises
                  void Promise.all(
                    ids.map((id) => toggleScript(id, false)),
                  );
                }}
                className="text-yellow-400 hover:text-yellow-300"
              >
                Disable
              </button>
            </div>
          )}
        </div>

        {/* Script list */}
        <div className="flex-1 overflow-y-auto">
          {loading && scripts.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-neutral-500">
              Loading…
            </div>
          ) : scripts.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-neutral-500">
              No scripts found. Create your first SSH event script.
            </div>
          ) : (
            scripts.map((script) => {
              const s = stats[script.id];
              const triggerLabel =
                TRIGGER_TYPES.find((t) => t.value === script.trigger.type)
                  ?.label ?? script.trigger.type;

              return (
                <div
                  key={script.id}
                  onClick={() => selectScript(script)}
                  className={`cursor-pointer border-b border-neutral-800 px-4 py-3 transition-colors hover:bg-neutral-800 ${
                    selectedScript?.id === script.id
                      ? "border-l-2 border-l-blue-500 bg-neutral-800"
                      : ""
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={bulkSelected.has(script.id)}
                      onChange={() => toggleBulk(script.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="mt-1"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={`h-2 w-2 rounded-full ${
                            script.enabled
                              ? "bg-green-400"
                              : "bg-neutral-600"
                          }`}
                        />
                        <span className="truncate text-sm font-medium text-white">
                          {script.name}
                        </span>
                      </div>
                      <div className="mt-1 flex gap-1.5">
                        <span className="rounded bg-neutral-700 px-1.5 py-0.5 text-[10px] text-neutral-400">
                          {triggerLabel}
                        </span>
                        <span className="rounded bg-neutral-700 px-1.5 py-0.5 text-[10px] text-neutral-400">
                          {script.language}
                        </span>
                        {s && s.totalRuns > 0 && (
                          <span className="rounded bg-neutral-700 px-1.5 py-0.5 text-[10px] text-neutral-400">
                            ×{s.totalRuns}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          void runScript({
                            scriptId: script.id,
                            sessionId,
                            connectionId,
                          });
                        }}
                        className="rounded p-1 text-xs text-neutral-400 hover:bg-neutral-700 hover:text-green-400"
                        title="Run now"
                      >
                        ▶
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          void toggleScript(script.id, !script.enabled);
                        }}
                        className="rounded p-1 text-xs text-neutral-400 hover:bg-neutral-700"
                        title={
                          script.enabled ? "Disable" : "Enable"
                        }
                      >
                        {script.enabled ? "🔔" : "🔕"}
                      </button>
                    </div>
                  </div>
                  {script.description && (
                    <p className="mt-1 truncate pl-5 text-xs text-neutral-500">
                      {script.description}
                    </p>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Right panel — detail / create */}
      <div className="flex flex-1 flex-col overflow-y-auto">
        {showCreate ? (
          <CreateScriptForm
            onSave={async (req) => {
              await createScript(req);
              setShowCreate(false);
            }}
            onCancel={() => setShowCreate(false)}
          />
        ) : selectedScript ? (
          <ScriptDetail
            script={selectedScript}
            stats={stats[selectedScript.id]}
            onRun={() =>
              void runScript({
                scriptId: selectedScript.id,
                sessionId,
                connectionId,
              })
            }
            onDuplicate={() => void duplicateScript(selectedScript.id)}
            onDelete={() => setConfirmDelete(selectedScript.id)}
            onToggle={() =>
              void toggleScript(selectedScript.id, !selectedScript.enabled)
            }
          />
        ) : (
          <div className="flex flex-1 items-center justify-center text-neutral-500">
            <div className="text-center">
              <p className="text-4xl">⚡</p>
              <p className="mt-3 text-sm">
                Select a script or create a new one
              </p>
              <button
                onClick={() => setShowCreate(true)}
                className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-500"
              >
                + Create Script
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Delete confirmation */}
      {confirmDelete && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
          <div className="rounded-lg border border-neutral-700 bg-neutral-900 p-6 shadow-xl">
            <p className="text-white">
              Delete this script? This cannot be undone.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setConfirmDelete(null)}
                className="rounded px-3 py-1.5 text-sm text-neutral-400 hover:bg-neutral-800"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  void deleteScript(confirmDelete);
                  setConfirmDelete(null);
                }}
                className="rounded bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-500"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

/* ══════════════════════════════════════════════════════════════════════════ */
/*  Script Detail                                                           */
/* ══════════════════════════════════════════════════════════════════════════ */

const ScriptDetail: React.FC<{
  script: SshEventScript;
  stats?: import("../../types/sshScripts").ScriptStats;
  onRun: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onToggle: () => void;
}> = ({ script, stats: s, onRun, onDuplicate, onDelete, onToggle }) => {
  const triggerInfo = TRIGGER_TYPES.find(
    (t) => t.value === script.trigger.type,
  );

  return (
    <div className="p-6">
      {/* Title bar */}
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-lg font-semibold text-white">{script.name}</h3>
          {script.description && (
            <p className="mt-1 text-sm text-neutral-400">
              {script.description}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={onRun}
            className="rounded-lg bg-green-600 px-4 py-1.5 text-sm text-white hover:bg-green-500"
          >
            ▶ Run
          </button>
          <button
            onClick={onToggle}
            className="rounded-lg border border-neutral-600 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800"
          >
            {script.enabled ? "Disable" : "Enable"}
          </button>
          <button
            onClick={onDuplicate}
            className="rounded-lg border border-neutral-600 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800"
          >
            Duplicate
          </button>
          <button
            onClick={onDelete}
            className="rounded-lg border border-red-800 px-3 py-1.5 text-sm text-red-400 hover:bg-red-900/40"
          >
            Delete
          </button>
        </div>
      </div>

      {/* Metadata grid */}
      <div className="mt-6 grid grid-cols-3 gap-4">
        <InfoCard
          label="Trigger"
          value={triggerInfo?.label ?? script.trigger.type}
          sub={triggerInfo?.description}
        />
        <InfoCard
          label="Language"
          value={script.language}
          sub={script.executionMode}
        />
        <InfoCard
          label="Status"
          value={script.enabled ? "Enabled ✅" : "Disabled ⛔"}
          sub={`Priority: ${script.priority}`}
        />
        {s && (
          <>
            <InfoCard
              label="Total Runs"
              value={String(s.totalRuns)}
              sub={`${s.successes} ok · ${s.failures} failed`}
            />
            <InfoCard
              label="Avg Duration"
              value={`${Math.round(s.averageDurationMs)}ms`}
              sub={s.lastRunAt ? `Last: ${new Date(s.lastRunAt).toLocaleString()}` : undefined}
            />
            <InfoCard
              label="Timeouts"
              value={String(s.timeouts)}
              sub={`Timeout: ${script.timeoutMs}ms`}
            />
          </>
        )}
      </div>

      {/* Trigger details */}
      <Section title="Trigger Configuration">
        <pre className="rounded-lg bg-neutral-800 p-3 text-xs text-neutral-300">
          {JSON.stringify(script.trigger, null, 2)}
        </pre>
      </Section>

      {/* Conditions */}
      {script.conditions.length > 0 && (
        <Section title={`Conditions (${script.conditions.length})`}>
          {script.conditions.map((c, i) => (
            <pre
              key={i}
              className="mb-2 rounded-lg bg-neutral-800 p-3 text-xs text-neutral-300"
            >
              {JSON.stringify(c, null, 2)}
            </pre>
          ))}
        </Section>
      )}

      {/* Variables */}
      {script.variables.length > 0 && (
        <Section title={`Variables (${script.variables.length})`}>
          <div className="space-y-2">
            {script.variables.map((v, i) => (
              <div
                key={i}
                className="flex items-center gap-3 rounded-lg bg-neutral-800 px-3 py-2"
              >
                <code className="text-sm font-medium text-blue-400">
                  {v.name}
                </code>
                <span className="rounded bg-neutral-700 px-1.5 py-0.5 text-[10px] text-neutral-400">
                  {v.source.type}
                </span>
                {v.sensitive && (
                  <span className="text-[10px] text-yellow-500">
                    🔒 sensitive
                  </span>
                )}
                <span className="ml-auto text-xs text-neutral-500">
                  default: {v.defaultValue || "—"}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Script content */}
      <Section title="Script Content">
        <pre className="max-h-[40vh] overflow-auto rounded-lg bg-neutral-950 p-4 text-xs text-green-400">
          {script.content}
        </pre>
      </Section>

      {/* Tags & scope */}
      <div className="mt-4 flex flex-wrap gap-2">
        {script.tags.map((t) => (
          <span
            key={t}
            className="rounded-full bg-blue-900/40 px-2.5 py-0.5 text-xs text-blue-300"
          >
            #{t}
          </span>
        ))}
        {script.category && (
          <span className="rounded-full bg-purple-900/40 px-2.5 py-0.5 text-xs text-purple-300">
            📁 {script.category}
          </span>
        )}
      </div>
      <div className="mt-2 text-xs text-neutral-600">
        Created {new Date(script.createdAt).toLocaleString()} · Updated{" "}
        {new Date(script.updatedAt).toLocaleString()} · v{script.version}
        {script.author && ` · by ${script.author}`}
      </div>
    </div>
  );
};

/* ══════════════════════════════════════════════════════════════════════════ */
/*  Create Script Form                                                      */
/* ══════════════════════════════════════════════════════════════════════════ */

const CreateScriptForm: React.FC<{
  onSave: (req: CreateScriptRequest) => Promise<void>;
  onCancel: () => void;
}> = ({ onSave, onCancel }) => {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [content, setContent] = useState("#!/bin/bash\n\n");
  const [language, setLanguage] = useState<ScriptLanguage>("bash");
  const [executionMode, setExecutionMode] = useState<ExecutionMode>("exec");
  const [triggerType, setTriggerType] = useState<string>("login");
  const [category, setCategory] = useState("Custom");
  const [tagsInput, setTagsInput] = useState("");
  const [timeoutMs, setTimeoutMs] = useState(30000);
  const [delayMs, setDelayMs] = useState(0);
  const [intervalMs, setIntervalMs] = useState(60000);
  const [cronExpr, setCronExpr] = useState("0 * * * *");
  const [pattern, setPattern] = useState("");
  const [idleMs, setIdleMs] = useState(300000);
  const [saving, setSaving] = useState(false);

  const buildTrigger = (): ScriptTrigger => {
    switch (triggerType) {
      case "login":
        return { type: "login", delayMs };
      case "logout":
        return { type: "logout", runOnError: false };
      case "reconnect":
        return { type: "reconnect" };
      case "connectionError":
        return { type: "connectionError" };
      case "interval":
        return { type: "interval", intervalMs };
      case "cron":
        return { type: "cron", expression: cronExpr };
      case "outputMatch":
        return {
          type: "outputMatch",
          pattern,
          cooldownMs: 5000,
        };
      case "idle":
        return { type: "idle", idleMs, repeat: false };
      case "manual":
        return { type: "manual" };
      case "resize":
        return { type: "resize" };
      case "keepaliveFailed":
        return { type: "keepaliveFailed", consecutiveFailures: 3 };
      case "portForwardChange":
        return { type: "portForwardChange" };
      case "hostKeyChanged":
        return { type: "hostKeyChanged" };
      default:
        return { type: "manual" };
    }
  };

  const handleSave = async () => {
    if (!name.trim() || !content.trim()) return;
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        description: description.trim() || undefined,
        content,
        language,
        executionMode,
        trigger: buildTrigger(),
        category,
        tags: tagsInput
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        timeoutMs,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6">
      <h3 className="text-lg font-semibold text-white">Create Script</h3>

      <div className="mt-6 space-y-4">
        {/* Name */}
        <FormField label="Name">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Login Banner Cleanup"
            className="w-full rounded-lg border border-neutral-600 bg-neutral-800 px-3 py-2 text-sm text-white placeholder-neutral-500 focus:border-blue-500 focus:outline-none"
          />
        </FormField>

        {/* Description */}
        <FormField label="Description">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What does this script do?"
            rows={2}
            className="w-full rounded-lg border border-neutral-600 bg-neutral-800 px-3 py-2 text-sm text-white placeholder-neutral-500 focus:border-blue-500 focus:outline-none"
          />
        </FormField>

        {/* Trigger + Language + Mode */}
        <div className="grid grid-cols-3 gap-4">
          <FormField label="Trigger">
            <select
              value={triggerType}
              onChange={(e) => setTriggerType(e.target.value)}
              className="w-full rounded-lg border border-neutral-600 bg-neutral-800 px-3 py-2 text-sm text-white"
            >
              {TRIGGER_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Language">
            <select
              value={language}
              onChange={(e) =>
                setLanguage(e.target.value as ScriptLanguage)
              }
              className="w-full rounded-lg border border-neutral-600 bg-neutral-800 px-3 py-2 text-sm text-white"
            >
              {SCRIPT_LANGUAGES.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Execution Mode">
            <select
              value={executionMode}
              onChange={(e) =>
                setExecutionMode(e.target.value as ExecutionMode)
              }
              className="w-full rounded-lg border border-neutral-600 bg-neutral-800 px-3 py-2 text-sm text-white"
            >
              {EXECUTION_MODES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </FormField>
        </div>

        {/* Trigger-specific fields */}
        {triggerType === "login" && (
          <FormField label="Delay after login (ms)">
            <input
              type="number"
              value={delayMs}
              onChange={(e) => setDelayMs(Number(e.target.value))}
              className="w-40 rounded-lg border border-neutral-600 bg-neutral-800 px-3 py-2 text-sm text-white"
            />
          </FormField>
        )}
        {triggerType === "interval" && (
          <FormField label="Interval (ms)">
            <input
              type="number"
              value={intervalMs}
              onChange={(e) => setIntervalMs(Number(e.target.value))}
              className="w-40 rounded-lg border border-neutral-600 bg-neutral-800 px-3 py-2 text-sm text-white"
            />
          </FormField>
        )}
        {triggerType === "cron" && (
          <FormField label="Cron expression">
            <input
              type="text"
              value={cronExpr}
              onChange={(e) => setCronExpr(e.target.value)}
              placeholder="0 * * * *"
              className="w-60 rounded-lg border border-neutral-600 bg-neutral-800 px-3 py-2 text-sm text-white font-mono"
            />
          </FormField>
        )}
        {triggerType === "outputMatch" && (
          <FormField label="Output regex pattern">
            <input
              type="text"
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              placeholder="error|fail|warn"
              className="w-full rounded-lg border border-neutral-600 bg-neutral-800 px-3 py-2 text-sm text-white font-mono"
            />
          </FormField>
        )}
        {triggerType === "idle" && (
          <FormField label="Idle timeout (ms)">
            <input
              type="number"
              value={idleMs}
              onChange={(e) => setIdleMs(Number(e.target.value))}
              className="w-40 rounded-lg border border-neutral-600 bg-neutral-800 px-3 py-2 text-sm text-white"
            />
          </FormField>
        )}

        {/* Category + Tags + Timeout */}
        <div className="grid grid-cols-3 gap-4">
          <FormField label="Category">
            <input
              type="text"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-lg border border-neutral-600 bg-neutral-800 px-3 py-2 text-sm text-white"
            />
          </FormField>
          <FormField label="Tags (comma-separated)">
            <input
              type="text"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="ssh, monitoring"
              className="w-full rounded-lg border border-neutral-600 bg-neutral-800 px-3 py-2 text-sm text-white"
            />
          </FormField>
          <FormField label="Timeout (ms)">
            <input
              type="number"
              value={timeoutMs}
              onChange={(e) => setTimeoutMs(Number(e.target.value))}
              className="w-full rounded-lg border border-neutral-600 bg-neutral-800 px-3 py-2 text-sm text-white"
            />
          </FormField>
        </div>

        {/* Script content */}
        <FormField label="Script Content">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={14}
            spellCheck={false}
            className="w-full rounded-lg border border-neutral-600 bg-neutral-950 px-4 py-3 font-mono text-sm text-green-400 placeholder-neutral-600 focus:border-blue-500 focus:outline-none"
          />
        </FormField>
      </div>

      {/* Footer */}
      <div className="mt-6 flex justify-end gap-3">
        <button
          onClick={onCancel}
          className="rounded-lg px-4 py-2 text-sm text-neutral-400 hover:bg-neutral-800"
        >
          Cancel
        </button>
        <button
          onClick={() => void handleSave()}
          disabled={!name.trim() || saving}
          className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {saving ? "Creating…" : "Create Script"}
        </button>
      </div>
    </div>
  );
};

/* ══════════════════════════════════════════════════════════════════════════ */
/*  Chains Tab                                                              */
/* ══════════════════════════════════════════════════════════════════════════ */

const ChainsTab: React.FC<{
  chains: ScriptChain[];
  scripts: SshEventScript[];
}> = ({ chains, scripts }) => {
  const scriptMap = new Map(scripts.map((s) => [s.id, s]));

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <h3 className="text-lg font-semibold text-white">
        Script Chains ({chains.length})
      </h3>
      <p className="mt-1 text-sm text-neutral-400">
        Define ordered pipelines of scripts that execute in sequence.
      </p>

      {chains.length === 0 ? (
        <div className="mt-8 text-center text-neutral-500">
          <p className="text-3xl">🔗</p>
          <p className="mt-2 text-sm">No chains defined yet.</p>
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          {chains.map((chain) => (
            <div
              key={chain.id}
              className="rounded-lg border border-neutral-700 bg-neutral-800 p-4"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-medium text-white">{chain.name}</h4>
                  {chain.description && (
                    <p className="text-sm text-neutral-400">
                      {chain.description}
                    </p>
                  )}
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${
                    chain.enabled
                      ? "bg-green-900/40 text-green-400"
                      : "bg-neutral-700 text-neutral-500"
                  }`}
                >
                  {chain.enabled ? "Enabled" : "Disabled"}
                </span>
              </div>
              <div className="mt-3 flex items-center gap-1">
                {chain.steps.map((step, i) => {
                  const s = scriptMap.get(step.scriptId);
                  return (
                    <React.Fragment key={i}>
                      {i > 0 && (
                        <span className="text-neutral-600">→</span>
                      )}
                      <span className="rounded bg-neutral-700 px-2 py-0.5 text-xs text-neutral-300">
                        {s?.name ?? step.scriptId}
                      </span>
                    </React.Fragment>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

/* ══════════════════════════════════════════════════════════════════════════ */
/*  History Tab                                                             */
/* ══════════════════════════════════════════════════════════════════════════ */

const HistoryTab: React.FC<{
  history: ExecutionRecord[];
  historyTotal: number;
  queryHistory: (
    q: import("../../types/sshScripts").HistoryQuery,
  ) => Promise<import("../../types/sshScripts").HistoryResponse>;
  clearHistory: () => Promise<void>;
}> = ({ history, historyTotal, queryHistory, clearHistory }) => {
  const [page, setPage] = useState(0);
  const limit = 50;

  React.useEffect(() => {
    void queryHistory({ offset: page * limit, limit });
  }, [page, queryHistory, limit]);

  const statusColor = (s: string) => {
    switch (s) {
      case "success":
        return "text-green-400";
      case "failed":
        return "text-red-400";
      case "timeout":
        return "text-yellow-400";
      case "cancelled":
        return "text-neutral-400";
      case "running":
        return "text-blue-400";
      default:
        return "text-neutral-300";
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white">
          Execution History ({historyTotal})
        </h3>
        <button
          onClick={() => void clearHistory()}
          className="rounded-lg border border-neutral-600 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800"
        >
          Clear
        </button>
      </div>

      {history.length === 0 ? (
        <div className="mt-8 text-center text-neutral-500">
          <p className="text-3xl">📊</p>
          <p className="mt-2 text-sm">No execution history yet.</p>
        </div>
      ) : (
        <div className="mt-4">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-neutral-700 text-xs text-neutral-400">
              <tr>
                <th className="pb-2">Script</th>
                <th className="pb-2">Trigger</th>
                <th className="pb-2">Status</th>
                <th className="pb-2">Duration</th>
                <th className="pb-2">Exit</th>
                <th className="pb-2">Started</th>
              </tr>
            </thead>
            <tbody>
              {history.map((r) => (
                <tr
                  key={r.id}
                  className="border-b border-neutral-800 hover:bg-neutral-800/50"
                >
                  <td className="py-2 text-white">{r.scriptName}</td>
                  <td className="py-2 text-neutral-400">{r.triggerType}</td>
                  <td className={`py-2 ${statusColor(r.status)}`}>
                    {r.status}
                  </td>
                  <td className="py-2 text-neutral-400">{r.durationMs}ms</td>
                  <td className="py-2 text-neutral-400">
                    {r.exitCode ?? "—"}
                  </td>
                  <td className="py-2 text-neutral-500">
                    {new Date(r.startedAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Pagination */}
          {historyTotal > limit && (
            <div className="mt-4 flex items-center gap-3 text-sm text-neutral-400">
              <button
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
                className="rounded px-2 py-1 hover:bg-neutral-800 disabled:opacity-30"
              >
                ← Prev
              </button>
              <span>
                Page {page + 1} of {Math.ceil(historyTotal / limit)}
              </span>
              <button
                disabled={(page + 1) * limit >= historyTotal}
                onClick={() => setPage((p) => p + 1)}
                className="rounded px-2 py-1 hover:bg-neutral-800 disabled:opacity-30"
              >
                Next →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/* ══════════════════════════════════════════════════════════════════════════ */
/*  Timers Tab                                                              */
/* ══════════════════════════════════════════════════════════════════════════ */

const TimersTab: React.FC<{
  timers: SchedulerEntry[];
}> = ({ timers }) => (
  <div className="flex-1 overflow-y-auto p-6">
    <h3 className="text-lg font-semibold text-white">
      Active Timers ({timers.length})
    </h3>
    <p className="mt-1 text-sm text-neutral-400">
      Interval, cron, and scheduled timers across all sessions.
    </p>

    {timers.length === 0 ? (
      <div className="mt-8 text-center text-neutral-500">
        <p className="text-3xl">⏱️</p>
        <p className="mt-2 text-sm">
          No active timers. Connect an SSH session with interval/cron scripts to
          see timers here.
        </p>
      </div>
    ) : (
      <div className="mt-4 space-y-2">
        {timers.map((t, i) => (
          <div
            key={i}
            className="flex items-center justify-between rounded-lg border border-neutral-700 bg-neutral-800 px-4 py-3"
          >
            <div>
              <span className="font-medium text-white">{t.scriptName}</span>
              <div className="mt-1 flex gap-2 text-xs text-neutral-400">
                <span>Session: {t.sessionId}</span>
                <span>·</span>
                <span>Trigger: {t.triggerType}</span>
                {t.intervalMs && <span>· Every {t.intervalMs}ms</span>}
              </div>
            </div>
            <div className="text-right text-xs text-neutral-400">
              {t.nextRunAt && (
                <div>
                  Next: {new Date(t.nextRunAt).toLocaleTimeString()}
                </div>
              )}
              <span
                className={
                  t.paused ? "text-yellow-500" : "text-green-500"
                }
              >
                {t.paused ? "⏸ Paused" : "▶ Running"}
              </span>
            </div>
          </div>
        ))}
      </div>
    )}
  </div>
);

/* ══════════════════════════════════════════════════════════════════════════ */
/*  Shared UI components                                                    */
/* ══════════════════════════════════════════════════════════════════════════ */

const Section: React.FC<{
  title: string;
  children: React.ReactNode;
}> = ({ title, children }) => (
  <div className="mt-6">
    <h4 className="mb-2 text-sm font-medium text-neutral-300">{title}</h4>
    {children}
  </div>
);

const InfoCard: React.FC<{
  label: string;
  value: string;
  sub?: string;
}> = ({ label, value, sub }) => (
  <div className="rounded-lg border border-neutral-700 bg-neutral-800 px-4 py-3">
    <div className="text-xs text-neutral-500">{label}</div>
    <div className="mt-0.5 text-sm font-medium text-white">{value}</div>
    {sub && <div className="mt-0.5 text-xs text-neutral-500">{sub}</div>}
  </div>
);

const FormField: React.FC<{
  label: string;
  children: React.ReactNode;
}> = ({ label, children }) => (
  <div>
    <label className="mb-1.5 block text-xs font-medium text-neutral-400">
      {label}
    </label>
    {children}
  </div>
);

export default SshEventScriptsManager;
