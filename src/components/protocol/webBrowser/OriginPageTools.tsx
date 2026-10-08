import React, {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  ArrowDown,
  ArrowUp,
  LoaderCircle,
  Minus,
  Plus,
  Search,
  X,
} from "lucide-react";
import type { OriginBrowserController } from "../../../hooks/protocol/useOriginBrowser";
import {
  useOriginFind,
  type OriginFindResult,
} from "../../../hooks/protocol/useOriginFind";
import type { OriginBrowserSnapshot } from "../../../types/protocols/originBrowser";
import { TextInput } from "../../ui/forms/TextInput";

/** Volatile, attempt-keyed shell controls. No page text or URL is persisted. */
export default function OriginPageTools({
  controller,
  enabled,
  defaultZoom,
  activeViewKey = "root",
  pageSnapshot = controller.state.snapshot,
  findResult,
  findOpenRequest,
  findReady = true,
}: {
  controller: OriginBrowserController;
  enabled: boolean;
  defaultZoom: number;
  /** Parent supplies the selected root/popup, not just the source attempt. */
  activeViewKey?: string;
  pageSnapshot?: OriginBrowserSnapshot | null;
  findResult?: OriginFindResult | null;
  findOpenRequest?: number;
  findReady?: boolean;
}) {
  const [zoom, setZoom] = useState<number | null>(null);
  const [zoomPending, setZoomPending] = useState(false);
  const zoomBusy = useRef(false);
  const [error, setError] = useState(false);
  const owner = pageSnapshot?.identity ?? controller.state.snapshot?.identity;
  const find = useOriginFind({
    controls: controller,
    enabled: enabled && findReady,
    scopeKey: JSON.stringify([
      owner?.ownerDatabaseId,
      owner?.connectionId,
      owner?.sessionId,
      owner?.attemptId,
      activeViewKey,
    ]),
    documentKey: pageSnapshot?.currentUrl ?? pageSnapshot?.displayUrl,
    loading: pageSnapshot?.loading,
    result: findResult,
    openRequest: findOpenRequest,
  });
  const findId = useId();
  const input = useRef<HTMLInputElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  const live = useRef(false);
  const visibility = useRef(0);
  useLayoutEffect(() => {
    live.current = true;
    const revision = ++visibility.current;
    return () => {
      live.current = false;
      visibility.current = revision + 1;
    };
  }, [enabled]);
  useEffect(() => {
    if (find.open && enabled) {
      input.current?.focus();
      input.current?.select();
    }
    if (!find.open && enabled && returnFocus.current) {
      returnFocus.current = false;
      toggle.current?.focus();
    }
  }, [find.open, find.focusRevision, enabled]);
  const showFind = find.show;
  useEffect(() => {
    if (!enabled) return;
    const shortcut = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.altKey ||
        !(event.ctrlKey || event.metaKey) ||
        event.key.toLowerCase() !== "f"
      )
        return;
      event.preventDefault();
      showFind();
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [enabled, showFind]);
  const applyZoom = async (percent: number) => {
    if (!enabled || zoomBusy.current) return;
    const revision = visibility.current;
    zoomBusy.current = true;
    setZoomPending(true);
    setError(false);
    const accepted = await controller.zoom(percent);
    zoomBusy.current = false;
    if (!live.current) return;
    setZoomPending(false);
    if (revision !== visibility.current) return;
    if (accepted) setZoom(percent);
    else setError(true);
  };
  // Apply the existing default through native IPC, never a CSS-only scale.
  const initialZoom = useRef(defaultZoom);
  const initialZoomRevision = useRef<number | null>(null);
  useLayoutEffect(() => {
    // Inherited defaults can change without a new native attempt. Invalidate
    // pending results before applying the newly resolved preference.
    if (initialZoom.current === defaultZoom) return;
    initialZoom.current = defaultZoom;
    visibility.current++;
    initialZoomRevision.current = null;
    setZoom(null);
  }, [defaultZoom]);
  const setNativeZoom = controller.zoom;
  useEffect(() => {
    if (
      !enabled ||
      zoom !== null ||
      zoomBusy.current ||
      initialZoomRevision.current === visibility.current
    )
      return;
    const revision = visibility.current;
    initialZoomRevision.current = revision;
    zoomBusy.current = true;
    setZoomPending(true);
    const settled = (accepted: boolean) => {
      zoomBusy.current = false;
      if (!live.current) return;
      setZoomPending(false);
      if (revision === visibility.current && accepted)
        setZoom(initialZoom.current);
    };
    void setNativeZoom(initialZoom.current).then(settled, () => settled(false));
    // Settlement must wake a skipped newer presentation. The revision latch
    // permits only one automatic request per eligibility epoch, even on failure.
  }, [enabled, zoom, zoomPending, setNativeZoom, defaultZoom]);
  const closeFind = () => {
    returnFocus.current = true;
    find.close();
  };
  const count = find.result;
  const noMatches = count?.finalUpdate && count.numberOfMatches === 0;
  const findStatus = !find.text
    ? "Type to search"
    : !find.valid
      ? "Search text is too long or contains NUL"
      : noMatches
        ? "No matches"
        : count && count.numberOfMatches > 0
          ? `${count.activeMatchOrdinal || "…"} of ${count.numberOfMatches}`
          : find.pending
            ? "Searching…"
            : find.submitted
              ? "Search sent"
              : "Ready to search";
  return (
    <>
      <div
        role="group"
        aria-label="Page zoom"
        className="flex shrink-0 items-center gap-0.5 border-l border-[var(--color-border)] pl-1"
      >
        <button
          type="button"
          className="sor-btn sor-icon-btn-sm !h-6 !w-6"
          aria-label="Zoom out"
          data-tooltip="Zoom out"
          disabled={!enabled || zoomPending || zoom === null || zoom <= 25}
          onClick={() => void applyZoom(Math.max(25, (zoom ?? 100) - 25))}
        >
          <Minus size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="sor-btn sor-btn-secondary !h-6 min-w-11 !px-1 text-[11px] tabular-nums"
          aria-label="Reset zoom"
          data-tooltip={
            zoom === null
              ? "Apply 100% zoom"
              : `Reset zoom to 100% (last applied ${zoom}%)`
          }
          disabled={!enabled || zoomPending}
          onClick={() => void applyZoom(100)}
        >
          {zoomPending ? (
            <LoaderCircle
              size={14}
              aria-hidden="true"
              className="animate-spin motion-reduce:animate-none"
            />
          ) : zoom === null ? (
            "Zoom"
          ) : (
            `${zoom}%`
          )}
        </button>
        <button
          type="button"
          className="sor-btn sor-icon-btn-sm !h-6 !w-6"
          aria-label="Zoom in"
          data-tooltip="Zoom in"
          disabled={!enabled || zoomPending || zoom === null || zoom >= 500}
          onClick={() => void applyZoom(Math.min(500, (zoom ?? 100) + 25))}
        >
          <Plus size={14} aria-hidden="true" />
        </button>
      </div>
      <button
        ref={toggle}
        type="button"
        className="sor-btn sor-icon-btn-sm shrink-0"
        aria-label="Find in page"
        data-tooltip="Find in page (Ctrl+F / ⌘F)"
        aria-expanded={find.open}
        aria-controls={find.open ? findId : undefined}
        disabled={!enabled || !findReady}
        onClick={() => (find.open ? closeFind() : find.show())}
      >
        <Search size={16} aria-hidden="true" />
      </button>
      {find.open && (
        <div
          id={findId}
          role="search"
          aria-label="Find in page controls"
          className="flex w-full flex-wrap items-center gap-1 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] p-1.5 shadow-sm"
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              closeFind();
            } else if (
              event.key === "Enter" &&
              event.target === input.current
            ) {
              event.preventDefault();
              event.stopPropagation();
              find.search(!event.shiftKey);
            }
          }}
        >
          <Search
            size={15}
            className="mx-1 shrink-0 text-[var(--color-textSecondary)]"
            aria-hidden="true"
          />
          <TextInput
            ref={input}
            variant="form-sm"
            className={`min-w-0 flex-[1_1_10rem] ${noMatches ? "border-warning" : ""}`}
            aria-label="Find text"
            placeholder="Find in page"
            value={find.text}
            onChange={find.setText}
            disabled={!enabled}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={!!find.text && !find.valid}
            aria-describedby={`${findId}-status ${findId}-hint`}
            onCompositionStart={() => find.setComposing(true)}
            onCompositionEnd={() => find.setComposing(false)}
          />
          <span
            id={`${findId}-status`}
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className={`mx-1 min-w-16 text-center text-xs tabular-nums ${noMatches ? "text-warning" : "text-[var(--color-textSecondary)]"}`}
          >
            {findStatus}
          </span>
          <label
            className="relative shrink-0 cursor-pointer"
            data-tooltip="Match case"
          >
            <input
              type="checkbox"
              className="peer sr-only"
              aria-label="Match case"
              checked={find.matchCase}
              onChange={(event) => find.setMatchCase(event.target.checked)}
              disabled={!enabled}
            />
            <span
              aria-hidden="true"
              className="sor-btn sor-icon-btn-sm text-xs peer-checked:bg-[var(--color-primary)] peer-checked:text-white peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-[var(--color-primary)] peer-disabled:opacity-50"
            >
              Aa
            </span>
          </label>
          <button
            type="button"
            className="sor-btn sor-icon-btn-sm"
            aria-label="Previous match"
            data-tooltip="Previous match (Shift+Enter)"
            disabled={!enabled || !find.valid}
            onClick={() => find.search(false)}
          >
            <ArrowUp size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="sor-btn sor-icon-btn-sm"
            aria-label="Next match"
            data-tooltip="Next match (Enter)"
            disabled={!enabled || !find.valid}
            onClick={() => find.search(true)}
          >
            {find.pending ? (
              <LoaderCircle
                size={16}
                aria-hidden="true"
                className="animate-spin motion-reduce:animate-none"
              />
            ) : (
              <ArrowDown size={16} aria-hidden="true" />
            )}
          </button>
          <button
            type="button"
            className="sor-btn sor-icon-btn-sm"
            aria-label="Close find"
            data-tooltip="Close find (Escape)"
            disabled={!enabled}
            onClick={closeFind}
          >
            <X size={16} aria-hidden="true" />
          </button>
          {!!find.text && !find.valid && (
            <span role="alert" className="w-full px-1 text-xs text-error">
              Search text must be at most 1,024 UTF-8 bytes with no NUL
              characters.
            </span>
          )}
          <span id={`${findId}-hint`} className="sr-only">
            Enter: next · Shift+Enter: previous · Esc: close
          </span>
        </div>
      )}
      {find.error && (
        <p role="alert" className="w-full text-xs text-error">
          {find.error}
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="sor-alert-warning w-full text-xs text-[var(--color-text)]"
        >
          Page control was not accepted. Check that this browser is active and
          try again.
        </p>
      )}
    </>
  );
}
