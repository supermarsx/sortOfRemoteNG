"use client";

import React, { useId, useLayoutEffect, useRef, useState } from "react";
import { Globe, LoaderCircle, X } from "lucide-react";
import type { OriginBrowserPopups } from "../../../hooks/protocol/useOriginBrowserPopups";
import styles from "./OriginPopupTabs.module.css";

/** Only adopted native child handles appear here. Main renders the selected
 * child's native viewport; this strip never creates a browser or app session. */
export default function OriginPopupTabs({
  popups,
  parentTitle = "Website",
}: {
  popups: OriginBrowserPopups;
  parentTitle?: string;
}) {
  const helpId = useId();
  const tabButtons = useRef(new Map<string | null, HTMLButtonElement>());
  const reorderFocus = useRef<string | null>(null);
  const [focusedViewId, setFocusedViewId] = useState<string | null | undefined>(
    undefined,
  );
  const [draggedViewId, setDraggedViewId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    viewId: string;
    placement: "before" | "after";
  } | null>(null);
  const selectableIds: (string | null)[] = [
    null,
    ...popups.tabs
      .filter((tab) => tab.phase === "adopted" && !tab.closing)
      .map((tab) => tab.viewId),
  ];
  const focusId =
    focusedViewId !== undefined && selectableIds.includes(focusedViewId)
      ? focusedViewId
      : popups.activeViewId;
  const focusTab = (viewId: string | null) => {
    const button = tabButtons.current.get(viewId);
    button?.focus();
    button?.scrollIntoView({ block: "nearest", inline: "nearest" });
  };
  useLayoutEffect(() => {
    if (reorderFocus.current === null) return;
    const button = tabButtons.current.get(reorderFocus.current);
    reorderFocus.current = null;
    button?.focus();
    button?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [popups.tabs]);
  const closeTab = (viewId: string) => {
    if (popups.tabs.find((tab) => tab.viewId === viewId)?.closing) return;
    const row = tabButtons.current.get(viewId)?.parentElement;
    if (row?.contains(document.activeElement)) {
      focusTab(popups.activeViewId === viewId ? null : popups.activeViewId);
    }
    void popups.close(viewId);
  };
  const onKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    viewId: string | null,
  ) => {
    if (event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.altKey) {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      event.stopPropagation();
      if (viewId === null) return;
      const movable = popups.tabs.filter((tab) => !tab.closing);
      const index = movable.findIndex((tab) => tab.viewId === viewId);
      const previous = event.key === "ArrowLeft";
      const target = movable[index + (previous ? -1 : 1)];
      if (target) {
        reorderFocus.current = viewId;
        popups.reorder(viewId, target.viewId, previous ? "before" : "after");
      }
      return;
    }
    if (event.key === "Delete" && viewId !== null) {
      event.preventDefault();
      event.stopPropagation();
      closeTab(viewId);
      return;
    }
    const index = selectableIds.indexOf(viewId);
    let next: number;
    switch (event.key) {
      case "ArrowLeft":
        next = (index - 1 + selectableIds.length) % selectableIds.length;
        break;
      case "ArrowRight":
        next = (index + 1) % selectableIds.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = selectableIds.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    focusTab(selectableIds[next]);
  };
  const preventMiddleScroll = (event: React.MouseEvent) => {
    if (event.button !== 1) return;
    event.preventDefault();
    event.stopPropagation();
  };
  const clearDrag = () => {
    setDraggedViewId(null);
    setDropTarget(null);
  };
  const dropPlacement = (event: React.DragEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return event.clientX < bounds.left + bounds.width / 2 ? "before" : "after";
  };

  if (!popups.tabs.length && !popups.error) return null;
  return (
    <div className={styles.strip} data-tauri-disable-drag="true">
      <p id={helpId} className="sr-only">
        Use Left and Right arrows, Home or End to focus tabs; Enter or Space to
        select. Drag child tabs or use Alt+Left or Alt+Right to reorder. Middle
        click or Delete closes a child tab.
      </p>
      <div
        role="tablist"
        aria-label="Website popup tabs"
        aria-orientation="horizontal"
        className={styles.tablist}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget))
            setFocusedViewId(undefined);
        }}
      >
        <div
          role="presentation"
          className={styles.tab}
          data-active={popups.activeViewId === null}
          onMouseDown={preventMiddleScroll}
          onAuxClick={preventMiddleScroll}
        >
          <button
            ref={(button) => {
              if (button) tabButtons.current.set(null, button);
              else tabButtons.current.delete(null);
            }}
            type="button"
            role="tab"
            aria-selected={popups.activeViewId === null}
            aria-describedby={helpId}
            tabIndex={focusId === null ? 0 : -1}
            title={parentTitle}
            className={styles.trigger}
            onFocus={() => setFocusedViewId(null)}
            onKeyDown={(event) => onKeyDown(event, null)}
            onClick={() => popups.select(null)}
          >
            <Globe size={14} aria-hidden="true" className={styles.icon} />
            <span className={styles.title}>{parentTitle}</span>
          </button>
        </div>
        {popups.tabs.map((tab, index) => {
          const title = tab.title || `Popup ${index + 1}`;
          const busy = tab.closing || tab.phase === "available";
          const status = tab.closing
            ? "Closing"
            : tab.phase === "available"
              ? "Opening"
              : "";
          return (
            <div
              key={tab.viewId}
              role="presentation"
              className={styles.tab}
              data-active={popups.activeViewId === tab.viewId}
              data-closing={tab.closing}
              data-dragging={draggedViewId === tab.viewId}
              data-drop={
                dropTarget?.viewId === tab.viewId
                  ? dropTarget.placement
                  : undefined
              }
              draggable={!tab.closing}
              onMouseDown={preventMiddleScroll}
              onAuxClick={(event) => {
                if (event.button !== 1) return;
                preventMiddleScroll(event);
                closeTab(tab.viewId);
              }}
              onDragStart={(event) => {
                event.stopPropagation();
                if (tab.closing) {
                  event.preventDefault();
                  return;
                }
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData(
                  "application/x-sorng-origin-popup-tab",
                  tab.viewId,
                );
                setDraggedViewId(tab.viewId);
              }}
              onDragOver={(event) => {
                event.stopPropagation();
                if (
                  !draggedViewId ||
                  draggedViewId === tab.viewId ||
                  tab.closing
                )
                  return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setDropTarget({
                  viewId: tab.viewId,
                  placement: dropPlacement(event),
                });
              }}
              onDragLeave={(event) => {
                if (
                  !event.currentTarget.contains(
                    event.relatedTarget as Node | null,
                  )
                )
                  setDropTarget(null);
              }}
              onDrop={(event) => {
                event.stopPropagation();
                if (!draggedViewId) return;
                event.preventDefault();
                popups.reorder(draggedViewId, tab.viewId, dropPlacement(event));
                clearDrag();
              }}
              onDragEnd={(event) => {
                event.stopPropagation();
                clearDrag();
              }}
            >
              <button
                ref={(button) => {
                  if (button) tabButtons.current.set(tab.viewId, button);
                  else tabButtons.current.delete(tab.viewId);
                }}
                type="button"
                role="tab"
                aria-selected={popups.activeViewId === tab.viewId}
                aria-label={`${title}${status ? ` · ${status}` : ""}`}
                aria-describedby={helpId}
                aria-busy={busy || undefined}
                aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight Delete"
                tabIndex={focusId === tab.viewId ? 0 : -1}
                title={title}
                disabled={tab.phase !== "adopted" || tab.closing}
                className={styles.trigger}
                onFocus={() => setFocusedViewId(tab.viewId)}
                onKeyDown={(event) => onKeyDown(event, tab.viewId)}
                onClick={() => popups.select(tab.viewId)}
              >
                {busy || tab.snapshot?.loading ? (
                  <LoaderCircle
                    size={14}
                    aria-hidden="true"
                    className={`${styles.icon} motion-safe:animate-spin`}
                  />
                ) : (
                  <Globe size={14} aria-hidden="true" className={styles.icon} />
                )}
                <span className={styles.title}>{title}</span>
                {status && <span className={styles.status}> · {status}</span>}
              </button>
              <button
                type="button"
                aria-label={`Close ${title}`}
                title={`Close ${title} (middle click)`}
                disabled={tab.closing}
                draggable={false}
                className={styles.close}
                onDragStart={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  closeTab(tab.viewId);
                }}
              >
                <X size={14} aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
      {popups.error && (
        <p role="alert" className="px-3 py-1 text-xs text-error">
          {popups.error}
        </p>
      )}
    </div>
  );
}
