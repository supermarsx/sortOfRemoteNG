import { useCallback, useRef, useState } from "react";
import type { DragEvent, KeyboardEvent } from "react";
import {
  moveQuickActionReference,
  quickActionReferenceKey,
  shiftQuickActionReference,
} from "../../utils/connection/sessionQuickActions";
import type { QuickActionReference } from "../../types/connection/sessionQuickActions";

export const FAVORITE_DRAG_MIME = "application/x-sorng-favorite";

export interface FavoriteDropTarget {
  key: string;
  placement: "before" | "after";
}

/**
 * Drag-and-drop plus Alt+Arrow keyboard reordering for a horizontal strip of
 * favorites. Shared by the SSH and serial bars; persistence is the caller's
 * `onReorder` (full ordered key list).
 */
export function useFavoriteReorder(
  items: readonly QuickActionReference[],
  onReorder: (orderedKeys: string[]) => void,
  enabled = true,
) {
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<FavoriteDropTarget | null>(null);
  const dragRef = useRef<string | null>(null);

  const commit = useCallback(
    (next: readonly QuickActionReference[]) => {
      if (next === items) return;
      onReorder(next.map(quickActionReferenceKey));
    },
    [items, onReorder],
  );

  const clear = useCallback(() => {
    dragRef.current = null;
    setDraggingKey(null);
    setDropTarget(null);
  }, []);

  const getItemProps = useCallback(
    (key: string) => ({
      draggable: enabled,
      "data-dragging": draggingKey === key ? "true" : undefined,
      "data-drop-position":
        dropTarget?.key === key && draggingKey !== key
          ? dropTarget.placement
          : undefined,
      onDragStart: (event: DragEvent<HTMLElement>) => {
        if (!enabled) return;
        dragRef.current = key;
        setDraggingKey(key);
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData(FAVORITE_DRAG_MIME, key);
      },
      onDragOver: (event: DragEvent<HTMLElement>) => {
        const from = dragRef.current;
        if (!enabled || !from) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        const rect = event.currentTarget.getBoundingClientRect();
        const placement =
          event.clientX > rect.left + rect.width / 2 ? "after" : "before";
        setDropTarget((previous) =>
          previous?.key === key && previous.placement === placement
            ? previous
            : { key, placement },
        );
      },
      onDrop: (event: DragEvent<HTMLElement>) => {
        const from = dragRef.current;
        if (!enabled || !from) return;
        event.preventDefault();
        const rect = event.currentTarget.getBoundingClientRect();
        const placement =
          event.clientX > rect.left + rect.width / 2 ? "after" : "before";
        clear();
        commit(moveQuickActionReference(items, from, key, placement));
      },
      onDragEnd: clear,
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
        if (!enabled || !event.altKey) return;
        const delta =
          event.key === "ArrowLeft" || event.key === "ArrowUp"
            ? -1
            : event.key === "ArrowRight" || event.key === "ArrowDown"
              ? 1
              : 0;
        if (!delta) return;
        event.preventDefault();
        event.stopPropagation();
        commit(shiftQuickActionReference(items, key, delta));
      },
    }),
    [clear, commit, draggingKey, dropTarget, enabled, items],
  );

  return { getItemProps, draggingKey, dropTarget };
}

/** Tailwind classes that render the drop indicator from `data-drop-position`. */
export const FAVORITE_DROP_CLASS =
  "data-[drop-position=before]:shadow-[-2px_0_0_0_var(--color-primary,#3b82f6)] data-[drop-position=after]:shadow-[2px_0_0_0_var(--color-primary,#3b82f6)] data-[dragging=true]:opacity-50";
