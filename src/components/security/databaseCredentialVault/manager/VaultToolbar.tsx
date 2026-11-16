import React, { useEffect, useMemo, useRef, useState } from "react";
import { Ellipsis, type LucideIcon } from "lucide-react";
import { PopoverSurface } from "../../../ui/overlays/PopoverSurface";
import {
  splitToolbarItems,
  type OverflowItem,
} from "../../../../utils/security/vaultManager/toolbarOverflow";
import type { VaultTx } from "./vaultText";

export interface VaultAction {
  id: string;
  label: string;
  icon: LucideIcon;
  onClick: (event: React.MouseEvent<HTMLElement>) => void;
  disabled?: boolean;
  /** Shown as the tooltip; explains why a control is disabled. */
  tooltip?: string;
  shortcut?: string;
  /** Lower numbers stay on the bar longest when space runs out. */
  priority: number;
  group: string;
  tone?: "primary" | "danger";
}

const BUTTON_WIDTH = 32;
const GROUP_GAP = 12;

/** Measures an element, falling back to `Infinity` where layout is absent. */
function useElementWidth(ref: React.RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState(Infinity);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry.contentRect.width || Infinity),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

export function VaultActionButton({
  action,
  menu = false,
}: {
  action: VaultAction;
  menu?: boolean;
}) {
  const Icon = action.icon;
  const tooltip =
    action.tooltip ??
    (action.shortcut ? `${action.label} (${action.shortcut})` : action.label);
  if (menu)
    return (
      <button
        type="button"
        role="menuitem"
        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-[var(--color-surfaceHover)] disabled:cursor-not-allowed disabled:opacity-45"
        disabled={action.disabled}
        data-tooltip={action.disabled ? tooltip : undefined}
        onClick={action.onClick}
      >
        <Icon size={14} aria-hidden="true" />
        <span className="flex-1 truncate">{action.label}</span>
        {action.shortcut && (
          <kbd className="text-[10px] text-[var(--color-textMuted)]">
            {action.shortcut}
          </kbd>
        )}
      </button>
    );
  return (
    <button
      type="button"
      className={`sor-icon-btn ${action.tone === "primary" ? "!text-primary" : ""} ${action.tone === "danger" ? "hover:!text-error" : ""}`}
      aria-label={action.label}
      aria-keyshortcuts={action.shortcut}
      data-tooltip={tooltip}
      disabled={action.disabled}
      onClick={action.onClick}
    >
      <Icon size={16} aria-hidden="true" />
    </button>
  );
}

/**
 * Icon toolbar that moves its lowest-priority actions into a "More actions"
 * menu when the row is too narrow. `availableWidth` overrides measurement
 * (used by tests, where no layout engine exists).
 */
export function VaultActionBar({
  actions,
  tx,
  label,
  availableWidth,
}: {
  actions: readonly VaultAction[];
  tx: VaultTx;
  label: string;
  availableWidth?: number;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const measured = useElementWidth(rowRef);
  const width = availableWidth ?? measured;
  const split = useMemo(() => {
    const items: OverflowItem[] = actions.map((action, index) => ({
      id: action.id,
      priority: action.priority,
      width:
        BUTTON_WIDTH +
        (index > 0 && actions[index - 1].group !== action.group
          ? GROUP_GAP
          : 0),
    }));
    return splitToolbarItems(items, width);
  }, [actions, width]);
  const visible = actions.filter((a) => split.visible.includes(a.id));
  const overflow = actions.filter((a) => split.overflow.includes(a.id));
  useEffect(() => {
    if (!overflow.length) setOpen(false);
  }, [overflow.length]);
  return (
    <div
      ref={rowRef}
      role="group"
      aria-label={label}
      className="flex min-w-0 flex-1 items-center gap-0.5"
    >
      {visible.map((action, index) => (
        <React.Fragment key={action.id}>
          {index > 0 && visible[index - 1].group !== action.group && (
            <span
              role="separator"
              aria-orientation="vertical"
              className="mx-1.5 h-5 w-px bg-[var(--color-border)]"
            />
          )}
          <VaultActionButton action={action} />
        </React.Fragment>
      ))}
      {overflow.length > 0 && (
        <>
          <button
            ref={moreRef}
            type="button"
            className="sor-icon-btn"
            aria-label={tx("moreActions")}
            aria-haspopup="menu"
            aria-expanded={open}
            data-tooltip={tx("moreActions")}
            onClick={() => setOpen((value) => !value)}
          >
            <Ellipsis size={16} aria-hidden="true" />
          </button>
          <PopoverSurface
            isOpen={open}
            anchorRef={moreRef}
            onClose={() => setOpen(false)}
            className="w-56 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-1 shadow-xl"
          >
            <div role="menu" aria-label={tx("moreActions")}>
              {overflow.map((action) => (
                <VaultActionButton
                  key={action.id}
                  menu
                  action={{
                    ...action,
                    onClick: (event) => {
                      setOpen(false);
                      action.onClick(event);
                    },
                  }}
                />
              ))}
            </div>
          </PopoverSurface>
        </>
      )}
    </div>
  );
}
