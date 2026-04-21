import React from "react";
import { TRIGGER_TYPES } from "../../../types/ssh/sshScripts";
import { Select } from "../../ui/forms";
import type { ScriptsTabProps } from "./types";
import { CreateScriptForm } from "./CreateScriptForm";
import { ScriptDetail } from "./ScriptDetail";

export const ScriptsTab: React.FC<ScriptsTabProps> = ({
  scripts,
  selectedScript,
  searchFilter,
  setSearchFilter,
  triggerFilter,
  setTriggerFilter,
  categoryFilter,
  setCategoryFilter,
  tagFilter: _tagFilter,
  setTagFilter: _setTagFilter,
  categories,
  tags: _tags,
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
      <div className="flex w-[380px] flex-col border-r border-theme-border">
        {/* Toolbar */}
        <div className="space-y-2 border-b border-theme-border px-3 py-3">
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Search scripts…"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              className="flex-1 rounded-lg border border-theme-border bg-surface px-3 py-1.5 text-sm text-[var(--color-text)] placeholder-text-muted focus:border-primary focus:outline-none"
            />
            <button
              onClick={() => setShowCreate(true)}
              className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-[var(--color-text)] hover:bg-primary/90"
            >
              + New
            </button>
          </div>
          <div className="flex gap-2">
            <Select
              value={triggerFilter}
              onChange={(v) => setTriggerFilter(v)}
              variant="form-sm"
              className="flex-1"
              options={[
                { value: "", label: "All Triggers" },
                ...TRIGGER_TYPES.map((t) => ({
                  value: t.value,
                  label: t.label,
                })),
              ]}
            />
            <Select
              value={categoryFilter}
              onChange={(v) => setCategoryFilter(v)}
              variant="form-sm"
              className="flex-1"
              options={[
                { value: "", label: "All Categories" },
                ...categories.map((c) => ({
                  value: c,
                  label: c,
                })),
              ]}
            />
          </div>
          {bulkSelected.size > 0 && (
            <div className="flex items-center gap-2 text-xs text-text-muted">
              <span>{bulkSelected.size} selected</span>
              <button
                onClick={() => {
                  const ids = [...bulkSelected];
                  setBulkSelected(new Set());
                  // eslint-disable-next-line @typescript-eslint/no-floating-promises
                  void Promise.all(ids.map((id) => deleteScript(id)));
                }}
                className="text-error hover:text-error"
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
                className="text-success hover:text-success"
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
                className="text-warning hover:text-warning"
              >
                Disable
              </button>
            </div>
          )}
        </div>

        {/* Script list */}
        <div className="flex-1 overflow-y-auto">
          {loading && scripts.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-text-secondary">
              Loading…
            </div>
          ) : scripts.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-text-secondary">
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
                  className={`cursor-pointer border-b border-theme-border px-4 py-3 transition-colors hover:bg-surfaceHover ${
                    selectedScript?.id === script.id
                      ? "border-l-2 border-l-primary bg-surface"
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
                              ? "bg-success"
                              : "bg-surfaceHover"
                          }`}
                        />
                        <span className="truncate text-sm font-medium text-[var(--color-text)]">
                          {script.name}
                        </span>
                      </div>
                      <div className="mt-1 flex gap-1.5">
                        <span className="rounded bg-surfaceHover px-1.5 py-0.5 text-[10px] text-text-muted">
                          {triggerLabel}
                        </span>
                        <span className="rounded bg-surfaceHover px-1.5 py-0.5 text-[10px] text-text-muted">
                          {script.language}
                        </span>
                        {s && s.totalRuns > 0 && (
                          <span className="rounded bg-surfaceHover px-1.5 py-0.5 text-[10px] text-text-muted">
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
                        className="rounded p-1 text-xs text-text-muted hover:bg-surfaceHover hover:text-success"
                        title="Run now"
                      >
                        ▶
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          void toggleScript(script.id, !script.enabled);
                        }}
                        className="rounded p-1 text-xs text-text-muted hover:bg-surfaceHover"
                        title={
                          script.enabled ? "Disable" : "Enable"
                        }
                      >
                        {script.enabled ? "🔔" : "🔕"}
                      </button>
                    </div>
                  </div>
                  {script.description && (
                    <p className="mt-1 truncate pl-5 text-xs text-text-secondary">
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
          <div className="flex flex-1 items-center justify-center text-text-secondary">
            <div className="text-center">
              <p className="text-4xl">⚡</p>
              <p className="mt-3 text-sm">
                Select a script or create a new one
              </p>
              <button
                onClick={() => setShowCreate(true)}
                className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm text-[var(--color-text)] hover:bg-primary/90"
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
          <div className="rounded-lg border border-theme-border bg-background p-6 shadow-xl">
            <p className="text-[var(--color-text)]">
              Delete this script? This cannot be undone.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setConfirmDelete(null)}
                className="rounded px-3 py-1.5 text-sm text-text-muted hover:bg-surfaceHover"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  void deleteScript(confirmDelete);
                  setConfirmDelete(null);
                }}
                className="rounded bg-error px-3 py-1.5 text-sm text-[var(--color-text)] hover:bg-error/90"
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
