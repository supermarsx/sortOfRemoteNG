import React, { useId, useState } from "react";
import {
  Circle,
  Code2,
  Library,
  Play,
  Square,
  Star,
  Trash2,
} from "lucide-react";
import type { useWebAutomation } from "../../../hooks/protocol/useWebAutomation";
import type {
  BrowserScript,
  WebAutomationItem,
} from "../../../types/recording/webAutomation";
import { MAX_WEB_SCRIPT_BYTES } from "../../../utils/recording/webAutomationLibrary";
import {
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
} from "../../ui/overlays/Modal";
import { ConfirmDialog } from "../../ui/dialogs/ConfirmDialog";

type Automation = ReturnType<typeof useWebAutomation>;
function newScript(): BrowserScript {
  const date = new Date().toISOString();
  return {
    kind: "script",
    id: crypto.randomUUID(),
    name: "New website script",
    description: "",
    code: "// Runs only on the current website. No native APIs.\n",
    createdAt: date,
    updatedAt: date,
  };
}

function FieldPrompt({ automation }: { automation: Automation }) {
  const [value, setValue] = useState("");
  const id = useId();
  return (
    <Modal
      isOpen
      onClose={() => automation.answerValue(null)}
      ariaLabel="Website macro field value"
      panelClassName="max-w-md mx-4 max-h-[85vh] flex flex-col overflow-hidden"
    >
      <ModalHeader title={`Value for field ${automation.valuePrompt!.index}`} />
      <ModalBody className="p-6 space-y-3 min-h-0 overflow-y-auto">
        <p className="text-sm text-[var(--color-textSecondary)]">
          This value is used once on the current page and is never saved in the
          macro. Password and authentication fields are not supported.
        </p>
        <label htmlFor={id} className="block text-sm">
          Field value
        </label>
        <input
          id={id}
          autoComplete="off"
          type="password"
          className="sor-form-input w-full"
          maxLength={4096}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      </ModalBody>
      <ModalFooter className="shrink-0 flex justify-end gap-2">
        <button
          className="sor-modal-cancel"
          onClick={() => {
            setValue("");
            automation.answerValue(null);
          }}
        >
          Cancel replay
        </button>
        <button
          className="sor-btn sor-btn-primary"
          onClick={() => {
            automation.answerValue(value);
            setValue("");
          }}
        >
          Fill once
        </button>
      </ModalFooter>
    </Modal>
  );
}

function AutomationLibrary({ automation }: { automation: Automation }) {
  const [draft, setDraft] = useState<WebAutomationItem | null>(() =>
      automation.steps.length
        ? automation.recordedMacro("New website macro")
        : null,
    ),
    [base, setBase] = useState<WebAutomationItem | undefined>();
  const [query, setQuery] = useState(""),
    [deleting, setDeleting] = useState<WebAutomationItem | null>(null);
  const ids = useId();
  const select = (item: WebAutomationItem) => {
    setBase(item);
    setDraft({ ...item });
  };
  const list = automation.allItems.filter((item) =>
    `${item.name} ${item.description} ${item.kind}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const save = async () => {
    if (!draft) return;
    const item = { ...draft, updatedAt: new Date().toISOString() };
    if (await automation.save(item, base)) {
      setBase(item);
      setDraft(item);
      automation.clearSteps();
    }
  };
  const isFavorite = (item: WebAutomationItem) =>
    automation.favorites.some(
      (ref) => ref.kind === item.kind && ref.id === item.id,
    );
  return (
    <>
      <Modal
        isOpen
        onClose={automation.busy ? undefined : () => automation.setOpen(false)}
        closeOnEscape={!automation.busy}
        closeOnBackdrop={!automation.busy}
        ariaLabel="Website automation library"
        panelClassName="max-w-4xl w-[calc(100vw-2rem)] max-h-[85vh] flex flex-col overflow-hidden"
      >
        <ModalHeader title="Website macros & scripts" />
        <ModalBody className="p-5 min-h-0 overflow-y-auto space-y-4">
          <p className="text-xs text-[var(--color-textSecondary)]">
            Separate from HAR/video recordings and terminal macros. Enable
            capabilities for this connection in Protocol → Advanced. Saved items
            use the desktop Macros artifact policy; favorites store IDs only.
          </p>
          {automation.error && (
            <p role="alert" className="text-error text-sm break-words">
              {automation.error}
            </p>
          )}
          {!automation.libraryReady ? (
            <div className="space-y-2">
              <p className="text-sm">
                The protected website library is unavailable. No browser-storage
                fallback or automatic reset is used.
              </p>
              <button
                className="sor-btn sor-btn-secondary"
                onClick={() => void automation.reload()}
              >
                Reload library
              </button>
            </div>
          ) : (
            <div className="grid md:grid-cols-[210px_minmax(0,1fr)] gap-4">
              <div className="space-y-2 min-w-0">
                <label htmlFor={`${ids}-search`} className="block text-xs">
                  Search library
                </label>
                <input
                  id={`${ids}-search`}
                  className="sor-form-input w-full"
                  placeholder="Name or type…"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                <button
                  className="sor-btn sor-btn-secondary w-full"
                  disabled={automation.busy}
                  onClick={() => {
                    setBase(undefined);
                    setDraft(newScript());
                  }}
                >
                  <Code2 size={14} />
                  New JavaScript
                </button>
                <div className="max-h-64 overflow-y-auto space-y-1">
                  {list.map((item) => (
                    <button
                      key={item.id}
                      className={`w-full text-left text-sm rounded px-2 py-1.5 truncate ${draft?.id === item.id ? "bg-primary/15 text-primary" : "hover:bg-[var(--color-surfaceHover)]"}`}
                      title={`${item.name} — ${item.kind}`}
                      disabled={automation.busy}
                      onClick={() => select(item)}
                    >
                      {item.kind === "macro" ? "Macro · " : "JS · "}
                      {item.name}
                    </button>
                  ))}
                  {!list.length && (
                    <p className="text-xs text-[var(--color-textMuted)] p-2">
                      No saved items match.
                    </p>
                  )}
                </div>
              </div>
              {draft ? (
                <div className="space-y-3 min-w-0">
                  <label htmlFor={`${ids}-name`} className="block text-xs">
                    Name
                  </label>
                  <input
                    id={`${ids}-name`}
                    className="sor-form-input w-full"
                    maxLength={100}
                    value={draft.name}
                    disabled={automation.busy}
                    onChange={(event) =>
                      setDraft({ ...draft, name: event.target.value })
                    }
                  />
                  <label
                    htmlFor={`${ids}-description`}
                    className="block text-xs"
                  >
                    Notes
                  </label>
                  <textarea
                    id={`${ids}-description`}
                    className="sor-form-textarea w-full"
                    rows={2}
                    maxLength={1000}
                    value={draft.description}
                    disabled={automation.busy}
                    onChange={(event) =>
                      setDraft({ ...draft, description: event.target.value })
                    }
                  />
                  {draft.kind === "script" ? (
                    <>
                      <label htmlFor={`${ids}-code`} className="block text-xs">
                        JavaScript · maximum 64 KiB
                      </label>
                      <textarea
                        id={`${ids}-code`}
                        spellCheck={false}
                        className="sor-form-textarea w-full min-h-32 max-h-56 font-mono text-xs"
                        rows={8}
                        maxLength={MAX_WEB_SCRIPT_BYTES}
                        value={draft.code}
                        disabled={automation.busy}
                        onChange={(event) =>
                          setDraft({ ...draft, code: event.target.value })
                        }
                      />
                      <p className="text-xs text-warning">
                        JavaScript runs with this page’s privileges, including
                        any signed-in session, and can change data or freeze the
                        page. Never store passwords or tokens in code. Stopping
                        cannot undo code that already ran.
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm">
                        {draft.steps.length} value-free steps
                      </p>
                      <ol className="max-h-48 overflow-y-auto space-y-1 text-xs font-mono">
                        {draft.steps.map((step, index) => (
                          <li key={index} className="break-all">
                            {index + 1}. {step.kind}
                            {step.kind === "fill"
                              ? " (ask at replay)"
                              : ""} · {step.selector}
                          </li>
                        ))}
                      </ol>
                      <p className="text-xs text-warning">
                        Review the current page before replay. Structural
                        positions may refer to different controls after a layout
                        change. Navigation stops the run; cross-origin frames
                        and login/secret fields are excluded.
                      </p>
                    </>
                  )}
                </div>
              ) : (
                <p className="text-sm text-[var(--color-textSecondary)] p-3">
                  Select a saved item, create JavaScript, or record interactions
                  from the bookmark bar. Typed values are never recorded.
                </p>
              )}
            </div>
          )}
        </ModalBody>
        <ModalFooter className="shrink-0 flex flex-wrap justify-end gap-2">
          {draft && automation.libraryReady && (
            <div className="flex flex-wrap gap-2 mr-auto">
              <button
                className="sor-btn sor-btn-primary"
                disabled={automation.busy || !draft.name.trim()}
                onClick={() => void save()}
              >
                Save {draft.kind}
              </button>
              <button
                className="sor-btn sor-btn-secondary"
                disabled={
                  automation.busy ||
                  !automation.pageReady ||
                  (draft.kind === "script"
                    ? !automation.permissions?.scriptInjectionEnabled
                    : !automation.permissions?.interactionMacrosEnabled)
                }
                onClick={() => automation.requestRun(draft)}
              >
                <Play size={14} />
                {draft.kind === "script" ? "Run JavaScript" : "Replay macro"}
              </button>
              {base && (
                <>
                  <button
                    className="sor-btn sor-btn-secondary"
                    disabled={automation.busy}
                    onClick={() => void automation.favorite(base)}
                  >
                    <Star
                      size={14}
                      fill={isFavorite(base) ? "currentColor" : "none"}
                    />
                    {isFavorite(base) ? "Remove favorite" : "Favorite"}
                  </button>
                  <button
                    className="sor-btn sor-btn-danger"
                    disabled={automation.busy}
                    onClick={() => setDeleting(base)}
                  >
                    <Trash2 size={14} />
                    Delete saved item
                  </button>
                </>
              )}
            </div>
          )}
          {automation.busy && !automation.saving && (
            <button
              className="sor-btn sor-btn-secondary"
              onClick={automation.cancel}
            >
              Stop action
            </button>
          )}
          <button
            className="sor-modal-cancel"
            disabled={automation.busy}
            onClick={() => automation.setOpen(false)}
          >
            Close library
          </button>
        </ModalFooter>
      </Modal>
      <ConfirmDialog
        isOpen={!!deleting}
        title="Delete saved website item?"
        message={`Delete “${deleting?.name ?? ""}” from the library? This does not undo actions already performed on a website.`}
        variant="danger"
        confirmText="Delete item"
        confirmOnEnter={false}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting)
            void automation.remove(deleting).then((deleted) => {
              if (deleted) {
                setDraft(null);
                setBase(undefined);
              }
              setDeleting(null);
            });
        }}
      />
    </>
  );
}

export function WebAutomationControls({
  automation,
}: {
  automation: Automation;
}) {
  const runAllowed = (item: WebAutomationItem) =>
    automation.pageReady &&
    !automation.busy &&
    !automation.recording &&
    (item.kind === "script"
      ? automation.permissions?.scriptInjectionEnabled
      : automation.permissions?.interactionMacrosEnabled);
  return (
    <>
      {(automation.permissions?.showActionBar || automation.error) && (
        <div className="flex items-center gap-1 shrink-0 border-l border-[var(--color-border)] pl-2 ml-2">
          <button
            className="sor-icon-btn-sm shrink-0 min-w-7 h-7"
            title="Website macros & JavaScript library"
            aria-label="Website macros & JavaScript library"
            onClick={() => automation.setOpen(true)}
          >
            <Library size={14} className="shrink-0" />
          </button>
          {automation.recording ? (
            <button
              className="sor-icon-btn-sm shrink-0 min-w-7 h-7 text-error"
              title="Stop recording and review macro"
              aria-label="Stop recording and review macro"
              onClick={() => void automation.stopRecording()}
            >
              <Square size={13} />
              <span className="text-xs">{automation.steps.length}</span>
            </button>
          ) : (
            <button
              className="sor-icon-btn-sm shrink-0 min-w-7 h-7"
              title={
                automation.permissions?.interactionMacrosEnabled
                  ? "Record website interactions (no typed values)"
                  : "Enable website macros in Protocol → Advanced"
              }
              aria-label="Record website interactions"
              disabled={
                !automation.libraryReady ||
                !automation.pageReady ||
                automation.busy ||
                !automation.permissions?.interactionMacrosEnabled
              }
              onClick={() => void automation.startRecording()}
            >
              <Circle size={13} className="shrink-0" />
            </button>
          )}
          {automation.favorites.map((item) => (
            <button
              key={item.id}
              className="sor-option-chip text-xs max-w-40"
              title={`${item.kind === "script" ? "Run JavaScript" : "Replay macro"}: ${item.name}`}
              disabled={!runAllowed(item)}
              onClick={() => automation.requestRun(item)}
            >
              {item.kind === "script" ? (
                <Code2 size={12} className="shrink-0" />
              ) : (
                <Play size={12} className="shrink-0" />
              )}
              <span className="truncate">{item.name}</span>
            </button>
          ))}
          {automation.busy && !automation.saving && (
            <button
              className="sor-icon-btn-sm"
              title="Stop website action; already-run JavaScript cannot be undone"
              aria-label="Stop website action"
              onClick={automation.cancel}
            >
              <Square size={14} />
            </button>
          )}
          {automation.error && (
            <span
              role="status"
              className="text-warning text-xs"
              title={automation.error}
            >
              Automation unavailable
            </span>
          )}
        </div>
      )}
      {automation.open && <AutomationLibrary automation={automation} />}
      {automation.pendingRun && (
        <Modal
          isOpen
          onClose={() => automation.setPendingRun(null)}
          ariaLabel="Review website action"
          panelClassName="max-w-xl mx-4 max-h-[85vh] flex flex-col overflow-hidden"
        >
          <ModalHeader
            title={
              automation.pendingRun.kind === "script"
                ? "Run JavaScript on this website?"
                : "Replay website macro?"
            }
          />
          <ModalBody className="p-6 space-y-3 min-h-0 overflow-y-auto">
            <p className="text-sm font-medium break-words">
              {automation.pendingRun.name}
            </p>
            <p className="text-sm text-warning">
              This acts on the current page, including any signed-in session,
              and can change website data. Review its layout and the action.
              Navigation or access changes cancel pending steps; completed
              actions cannot be undone.
            </p>
            {automation.pendingRun.kind === "script" ? (
              <pre className="text-xs whitespace-pre-wrap break-all max-h-60 overflow-y-auto bg-[var(--color-background)] p-3 rounded">
                {automation.pendingRun.code}
              </pre>
            ) : (
              <p className="text-sm">
                {automation.pendingRun.steps.length} steps. Typed values are
                requested once and are never saved.
              </p>
            )}
          </ModalBody>
          <ModalFooter className="shrink-0 flex justify-end gap-2">
            <button
              className="sor-modal-cancel"
              onClick={() => automation.setPendingRun(null)}
            >
              Cancel
            </button>
            <button
              className="sor-btn sor-btn-primary"
              disabled={!runAllowed(automation.pendingRun)}
              onClick={() => void automation.execute(automation.pendingRun!)}
            >
              Run on current page
            </button>
          </ModalFooter>
        </Modal>
      )}
      {automation.valuePrompt && (
        <FieldPrompt
          key={automation.valuePrompt.index}
          automation={automation}
        />
      )}
    </>
  );
}
