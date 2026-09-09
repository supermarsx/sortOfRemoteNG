import React, { useEffect, useState } from "react";
import { ConfirmDialog } from "../../ui/dialogs/ConfirmDialog";
import { useWebsiteUserScripts } from "../../../hooks/recording/useWebsiteUserScripts";
import type { BrowserScript } from "../../../types/recording/webAutomation";
import ScriptCodeEditor from "../../ui/editor/ScriptCodeEditor";
import { MAX_WEB_SCRIPT_BYTES } from "../../../utils/recording/webAutomationLibrary";

type Manager = ReturnType<typeof useWebsiteUserScripts>;
interface Callbacks {
  onDirtyChange?: (dirty: boolean) => void;
  onBusyChange?: (busy: boolean) => void;
}
function AccessibleScripts({
  mgr,
  onDirtyChange,
}: { mgr: Manager } & Callbacks) {
  const [search, setSearch] = useState("");
  const [edit, setEdit] = useState<{
    item: BrowserScript;
    expected?: BrowserScript;
  } | null>(null);
  const [deleting, setDeleting] = useState<BrowserScript | null>(null);
  const [selected, setSelected] = useState<BrowserScript | null>(null);
  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null);
  useEffect(() => {
    onDirtyChange?.(edit !== null);
  }, [edit, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  const requestLeave = (action: () => void) => {
    if (edit) setPendingLeave(() => action);
    else action();
  };
  const current = selected
    ? mgr.scripts.find((item) => item.id === selected.id)
    : undefined;
  const stale =
    selected !== null && JSON.stringify(current) !== JSON.stringify(selected);
  const create = (source?: BrowserScript) =>
    requestLeave(() => {
      const now = new Date().toISOString();
      setDeleting(null);
      setSelected(null);
      setEdit({
        item: {
          id: crypto.randomUUID(),
          kind: "script",
          name: source ? `${source.name.slice(0, 93)} (Copy)` : "",
          description: source?.description ?? "",
          code: source?.code ?? "",
          createdAt: now,
          updatedAt: now,
        },
      });
    });
  return (
    <div className="min-h-0 flex-1 overflow-auto p-4 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="sor-form-input min-w-0 flex-1"
          aria-label="Search website userscripts"
          placeholder="Search website userscripts"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <button
          type="button"
          className="sor-btn sor-btn-primary"
          disabled={mgr.busy}
          onClick={() => create()}
        >
          New website script
        </button>
      </div>
      <div className="grid min-w-0 gap-4 md:grid-cols-[minmax(12rem,1fr)_minmax(0,2fr)]">
        <div className="space-y-2">
          {mgr.scripts
            .filter((item) =>
              `${item.name} ${item.description}`
                .toLowerCase()
                .includes(search.toLowerCase()),
            )
            .map((item) => (
              <button
                type="button"
                key={item.id}
                className={`w-full rounded border p-3 text-left ${selected?.id === item.id ? "border-primary" : "border-[var(--color-border)]"}`}
                disabled={mgr.busy}
                onClick={() => {
                  requestLeave(() => {
                    setEdit(null);
                    setDeleting(null);
                    setSelected(item);
                  });
                }}
              >
                <span className="block truncate font-medium">{item.name}</span>
                <span className="block truncate text-xs text-[var(--color-textMuted)]">
                  {item.description || "Manual website JavaScript"}
                </span>
              </button>
            ))}
          {!mgr.scripts.length && (
            <p className="text-sm">No website userscripts saved.</p>
          )}
        </div>
        <div className="min-w-0 space-y-3">
          {edit ? (
            <>
              <label className="block text-sm">
                Script name
                <input
                  className="sor-form-input mt-1 w-full"
                  maxLength={100}
                  disabled={mgr.busy}
                  value={edit.item.name}
                  onChange={(event) =>
                    setEdit({
                      ...edit,
                      item: { ...edit.item, name: event.target.value },
                    })
                  }
                />
              </label>
              <label className="block text-sm">
                Description
                <input
                  className="sor-form-input mt-1 w-full"
                  maxLength={1000}
                  disabled={mgr.busy}
                  value={edit.item.description}
                  onChange={(event) =>
                    setEdit({
                      ...edit,
                      item: { ...edit.item, description: event.target.value },
                    })
                  }
                />
              </label>
              <div className="block text-sm">
                Website JavaScript
                <ScriptCodeEditor
                  ariaLabel="Website JavaScript"
                  language="javascript"
                  documentKey={edit.item.id}
                  minHeight={256}
                  readOnly={mgr.busy}
                  code={edit.item.code}
                  onChange={(code) =>
                    setEdit({
                      ...edit,
                      item: { ...edit.item, code },
                    })
                  }
                />
              </div>
              <p className="text-xs text-[var(--color-textMuted)]">
                Maximum 64 KiB of credential-free source. This is page
                JavaScript, not a browser-extension userscript engine; @grant,
                @require and automatic URL matching are not supported.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="sor-btn sor-btn-secondary"
                  disabled={mgr.busy}
                  onClick={() => {
                    requestLeave(() => setEdit(null));
                  }}
                >
                  Cancel edit
                </button>
                <button
                  type="button"
                  className="sor-btn sor-btn-primary"
                  disabled={
                    mgr.busy ||
                    !edit.item.name.trim() ||
                    !edit.item.code.trim() ||
                    new TextEncoder().encode(edit.item.code).length >
                      MAX_WEB_SCRIPT_BYTES
                  }
                  onClick={async () => {
                    const item = {
                      ...edit.item,
                      name: edit.item.name.trim(),
                      updatedAt: new Date().toISOString(),
                    };
                    if (await mgr.save(item, edit.expected)) {
                      setEdit(null);
                      setSelected(item);
                    }
                  }}
                >
                  Save website script
                </button>
              </div>
            </>
          ) : selected && stale ? (
            <div className="space-y-2">
              <p role="status">
                This script was {current ? "changed" : "deleted"} in another
                library view. Review its current version before using inspection
                actions.
              </p>
              <button
                type="button"
                className="sor-btn sor-btn-secondary"
                onClick={() => {
                  setDeleting(null);
                  setSelected(current ?? null);
                }}
              >
                {current ? "Review current version" : "Clear selection"}
              </button>
            </div>
          ) : selected ? (
            <>
              <h3 className="font-medium">{selected.name}</h3>
              <p className="text-sm">{selected.description}</p>
              <ScriptCodeEditor
                code={selected.code}
                language="javascript"
                onChange={() => {}}
                readOnly
                ariaLabel="Website script source"
                documentKey={`${selected.id}:${selected.updatedAt}`}
                minHeight={200}
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="sor-btn sor-btn-secondary"
                  disabled={mgr.busy}
                  onClick={() =>
                    setEdit({
                      item: structuredClone(selected),
                      expected: structuredClone(selected),
                    })
                  }
                >
                  Edit website script
                </button>
                <button
                  type="button"
                  className="sor-btn sor-btn-secondary"
                  disabled={mgr.busy}
                  onClick={() => create(selected)}
                >
                  Duplicate website script
                </button>
                <button
                  type="button"
                  className="sor-btn sor-btn-secondary"
                  disabled={mgr.busy}
                  onClick={() => setDeleting(structuredClone(selected))}
                >
                  Delete website script
                </button>
              </div>
              {deleting && (
                <div className="rounded border border-warning p-3 space-y-2">
                  <p className="text-sm">
                    Delete “{deleting.name}” from the protected library?
                    Existing connection favorite references will remain
                    unresolved until removed or replaced.
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="sor-btn sor-btn-secondary"
                      disabled={mgr.busy}
                      onClick={() => setDeleting(null)}
                    >
                      Cancel deletion
                    </button>
                    <button
                      type="button"
                      className="sor-btn sor-btn-danger"
                      disabled={mgr.busy}
                      onClick={async () => {
                        if (await mgr.remove(deleting)) {
                          setDeleting(null);
                          setSelected(null);
                        }
                      }}
                    >
                      Confirm deletion
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-[var(--color-textMuted)]">
              Select a website script to review its source, or create one. This
              manager never executes scripts.
            </p>
          )}
        </div>
      </div>
      <ConfirmDialog
        isOpen={pendingLeave !== null}
        title="Discard website script draft?"
        message="Your unsaved website script changes will be discarded. Saved scripts and favorites are unchanged."
        confirmText="Discard draft"
        cancelText="Keep editing"
        variant="warning"
        confirmOnEnter={false}
        onCancel={() => setPendingLeave(null)}
        onConfirm={() => {
          const action = pendingLeave;
          setPendingLeave(null);
          action?.();
        }}
      />
    </div>
  );
}
export default function WebsiteUserScriptsPanel({
  onDirtyChange,
  onBusyChange,
}: Callbacks = {}) {
  const mgr = useWebsiteUserScripts();
  useEffect(() => {
    onBusyChange?.(mgr.busy);
    return () => onBusyChange?.(false);
  }, [mgr.busy, onBusyChange]);
  return (
    <section
      className="flex min-h-0 flex-1 flex-col"
      aria-label="Website userscript library"
    >
      <div className="border-b border-[var(--color-border)] p-4 space-y-2">
        <h2 className="font-medium">Website userscripts · JavaScript</h2>
        <p className="text-sm">
          A separate protected library for HTTP/HTTPS favorites. Pin saved
          scripts from the website action bar; running still requires global
          availability, explicit per-connection script permission and normal
          confirmation. Editing here grants none of those permissions.
        </p>
        {mgr.error && (
          <p role="alert" className="text-sm text-error">
            {mgr.error}
          </p>
        )}
      </div>
      {mgr.ready ? (
        <AccessibleScripts
          key={mgr.epoch}
          mgr={mgr}
          onDirtyChange={onDirtyChange}
        />
      ) : (
        <p className="p-4 text-sm">
          Website script editing is unavailable until the protected library and
          its owning database are accessible.
        </p>
      )}
    </section>
  );
}
