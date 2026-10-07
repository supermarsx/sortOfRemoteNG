import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
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
import { TextInput } from "../../ui/forms/TextInput";
import { CheckboxField } from "../../ui/forms/Checkbox";

/** Volatile, attempt-keyed shell controls. No page text or URL is persisted. */
export default function OriginPageTools({
  controller,
  enabled,
  defaultZoom,
}: {
  controller: OriginBrowserController;
  enabled: boolean;
  defaultZoom: number;
}) {
  const [zoom, setZoom] = useState<number | null>(null);
  const [zoomPending, setZoomPending] = useState(false);
  const zoomBusy = useRef(false);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [findPending, setFindPending] = useState(false);
  const findBusy = useRef(false);
  const [error, setError] = useState(false);
  const lastFind = useRef<{ text: string; matchCase: boolean } | null>(null);
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
    if (open && enabled) input.current?.focus();
    if (!open && enabled && returnFocus.current) {
      returnFocus.current = false;
      toggle.current?.focus();
    }
  }, [open, enabled]);
  // A navigation starts a new document; do not ask native to continue an old find.
  useEffect(() => {
    lastFind.current = null;
  }, [
    controller.state.snapshot?.currentUrl,
    controller.state.snapshot?.loading,
  ]);
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
  const valid =
    !!text &&
    !text.includes("\0") &&
    new TextEncoder().encode(text).length <= 1024;
  const search = async (forward: boolean) => {
    if (!enabled || !valid || findBusy.current) return;
    const revision = visibility.current;
    const query = { text, matchCase };
    findBusy.current = true;
    setFindPending(true);
    setError(false);
    const accepted = await controller.find(
      text,
      forward,
      matchCase,
      lastFind.current?.text === text &&
        lastFind.current?.matchCase === matchCase,
    );
    findBusy.current = false;
    if (!live.current) return;
    setFindPending(false);
    if (revision !== visibility.current) return;
    if (accepted) lastFind.current = query;
    else setError(true);
  };
  const closeFind = async () => {
    if (!enabled || findBusy.current) return;
    const revision = visibility.current;
    findBusy.current = true;
    setFindPending(true);
    const accepted = await controller.stopFind(true);
    findBusy.current = false;
    if (!live.current) return;
    setFindPending(false);
    if (revision !== visibility.current) return;
    if (!accepted) {
      setError(true);
      return;
    }
    lastFind.current = null;
    setText("");
    returnFocus.current = true;
    setOpen(false);
  };
  return (
    <>
      <div
        role="group"
        aria-label="Page zoom"
        className="flex shrink-0 items-center gap-0.5 border-l border-[var(--color-border)] pl-1"
      >
        <button
          type="button"
          className="sor-btn sor-icon-btn-sm"
          aria-label="Zoom out"
          data-tooltip="Zoom out"
          disabled={!enabled || zoomPending || zoom === null || zoom <= 25}
          onClick={() => void applyZoom(Math.max(25, (zoom ?? 100) - 25))}
        >
          <Minus size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="sor-btn sor-btn-secondary min-w-14 text-xs"
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
          className="sor-btn sor-icon-btn-sm"
          aria-label="Zoom in"
          data-tooltip="Zoom in"
          disabled={!enabled || zoomPending || zoom === null || zoom >= 500}
          onClick={() => void applyZoom(Math.min(500, (zoom ?? 100) + 25))}
        >
          <Plus size={16} aria-hidden="true" />
        </button>
      </div>
      <button
        ref={toggle}
        type="button"
        className="sor-btn sor-icon-btn-sm shrink-0"
        aria-label="Find in page"
        data-tooltip="Find in page"
        aria-expanded={open}
        disabled={!enabled || findPending}
        onClick={() => (open ? closeFind() : setOpen(true))}
      >
        <Search size={16} aria-hidden="true" />
      </button>
      {open && (
        <div
          role="group"
          aria-label="Find in page controls"
          className="flex w-full flex-wrap items-center gap-2 border-t border-[var(--color-border)] pt-2"
        >
          <TextInput
            ref={input}
            variant="form-sm"
            className="min-w-0 flex-[1_1_12rem]"
            aria-label="Find text"
            placeholder="Find in page"
            value={text}
            onChange={(value) => {
              setText(value);
              lastFind.current = null;
            }}
            disabled={!enabled}
            readOnly={findPending}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={!!text && !valid}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.stopPropagation();
                void search(!event.shiftKey);
              }
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                closeFind();
              }
            }}
          />
          <CheckboxField
            variant="form"
            label="Match case"
            checked={matchCase}
            onChange={(value) => {
              setMatchCase(value);
              lastFind.current = null;
            }}
            disabled={!enabled || findPending}
            wrapperClassName="text-xs"
          />
          <button
            type="button"
            className="sor-btn sor-icon-btn-sm"
            aria-label="Previous match"
            data-tooltip="Previous match (Shift+Enter)"
            disabled={!enabled || !valid || findPending}
            onClick={() => void search(false)}
          >
            <ArrowUp size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="sor-btn sor-icon-btn-sm"
            aria-label="Next match"
            data-tooltip="Next match (Enter)"
            disabled={!enabled || !valid || findPending}
            onClick={() => void search(true)}
          >
            {findPending ? (
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
            disabled={!enabled || findPending}
            onClick={closeFind}
          >
            <X size={16} aria-hidden="true" />
          </button>
          {!!text && !valid && (
            <span role="alert" className="text-xs text-error">
              Search text must be at most 1,024 UTF-8 bytes with no NUL
              characters.
            </span>
          )}
        </div>
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
