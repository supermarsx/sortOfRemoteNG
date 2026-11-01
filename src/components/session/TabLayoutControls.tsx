"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Check,
  ChevronDown,
  Columns,
  Eye,
  Grid3X3,
  LayoutGrid,
  Minimize2,
  Rows,
  Settings2,
  Square,
  SquareStack,
} from "lucide-react";
import type {
  ConnectionSession,
  TabLayout,
  TabLayoutMode,
} from "../../types/connection/connection";
import { useTabLayoutManager } from "../../hooks/session/useTabLayoutManager";
import { partitionSessions } from "../../utils/session/sessionClassification";
import MenuSurface from "../ui/overlays/MenuSurface";
import { PopoverSurface } from "../ui/overlays/PopoverSurface";
import { Slider } from "../ui/forms";

const ignoreClose = () => {};

interface TabLayoutControlsProps {
  sessions: ConnectionSession[];
  activeSessionId?: string;
  layout: TabLayout;
  onLayoutChange: (layout: TabLayout) => void;
  onSessionSelect: (sessionId: string) => void;
}

/** Compact tab-strip control. Viewer ownership stays in TabLayoutManager. */
export function TabLayoutControls({
  sessions,
  activeSessionId,
  layout,
  onLayoutChange,
  onSessionSelect,
}: TabLayoutControlsProps) {
  const { t } = useTranslation();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const gridId = useId();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const mgr = useTabLayoutManager(
    sessions,
    activeSessionId,
    layout,
    onLayoutChange,
    ignoreClose,
    false,
  );
  const modes = [
    {
      mode: "tabs",
      label: t("session.tabLayout.modes.tabs", "Tabs (single pane)"),
      icon: Minimize2,
    },
    {
      mode: "splitVertical",
      label: t("session.tabLayout.modes.splitVertical", "Split left/right"),
      icon: Columns,
    },
    {
      mode: "splitHorizontal",
      label: t("session.tabLayout.modes.splitHorizontal", "Split top/bottom"),
      icon: Rows,
    },
    {
      mode: "sideBySide",
      label: t(
        "session.tabLayout.modes.sideBySide",
        "Side-by-side (2 cols, fill rows)",
      ),
      icon: SquareStack,
    },
    {
      mode: "grid2",
      label: t("session.tabLayout.modes.grid2", "2 side by side (capped)"),
      icon: LayoutGrid,
    },
    {
      mode: "grid4",
      label: t("session.tabLayout.modes.grid4", "4 squares (capped)"),
      icon: Grid3X3,
    },
    {
      mode: "grid6",
      label: t("session.tabLayout.modes.grid6", "6 squares (capped)"),
      icon: Grid3X3,
    },
    {
      mode: "mosaic",
      label: t("session.tabLayout.modes.mosaic", "Auto mosaic (sqrt grid)"),
      icon: Square,
    },
    {
      mode: "miniMosaic",
      label: t(
        "session.tabLayout.modes.miniMosaic",
        "Mini mosaic (preview grid)",
      ),
      icon: Grid3X3,
    },
  ] satisfies Array<{
    mode: TabLayoutMode;
    label: string;
    icon: typeof LayoutGrid;
  }>;
  const current = modes.find(({ mode }) => mode === layout.mode);
  const Icon = current?.icon ?? Settings2;
  const customLabel = t(
    "session.tabLayout.customGrid.buttonTitle",
    "Custom grid layout",
  );
  const viewLabel = t("session.tabLayout.viewMode", "View mode");
  const capped = ["grid2", "grid4", "grid6", "customGrid"].includes(
    layout.mode,
  );
  const hiddenSessions = capped ? mgr.hiddenSessions : [];
  const connectionCount = partitionSessions(sessions).connections.length;

  const openMenu = () => {
    triggerRef.current?.focus({ preventScroll: true });
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setMenu({ x: rect.right - 280, y: rect.bottom + 4 });
  };
  const openCustomGrid = () => {
    setMenu(null);
    // The strip also mounts before persisted layouts finish loading.
    if (layout.customCols !== undefined) mgr.setCustomCols(layout.customCols);
    if (layout.customRows !== undefined) mgr.setCustomRows(layout.customRows);
    mgr.setShowCustomGrid(true);
  };
  useEffect(() => {
    if (!mgr.showCustomGrid) return;
    // PopoverSurface measures and reveals itself in its first animation frame.
    // Focus after that visibility update has committed in the real browser.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() =>
        gridRef.current?.querySelector<HTMLInputElement>("input")?.focus(),
      );
    });
    const trigger = triggerRef.current;
    return () => {
      cancelAnimationFrame(frame);
      trigger?.focus({ preventScroll: true });
    };
  }, [mgr.showCustomGrid]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="sor-accent-choice flex h-8 items-center gap-1 rounded px-2"
        aria-label={viewLabel}
        title={`${viewLabel}: ${current?.label ?? customLabel}`}
        aria-haspopup={mgr.showCustomGrid ? "dialog" : "menu"}
        aria-expanded={menu !== null || mgr.showCustomGrid}
        data-testid="tab-layout-trigger"
        onClick={() => {
          if (menu || mgr.showCustomGrid) {
            setMenu(null);
            mgr.setShowCustomGrid(false);
          } else openMenu();
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !menu && !mgr.showCustomGrid) {
            event.preventDefault();
            openMenu();
          }
        }}
      >
        <Icon size={16} aria-hidden="true" />
        <ChevronDown size={12} aria-hidden="true" />
      </button>
      <MenuSurface
        isOpen={menu !== null}
        onClose={() => setMenu(null)}
        position={menu}
        ignoreRefs={[triggerRef]}
        className="w-[280px] max-w-[calc(100vw-8px)] max-h-[calc(100vh-16px)] overflow-y-auto"
        ariaLabel={viewLabel}
        dataTestId="tab-layout-menu"
      >
        {modes.map(({ mode, label, icon: ModeIcon }) => (
          <button
            key={mode}
            type="button"
            className="sor-menu-item w-full"
            role="menuitem"
            aria-current={layout.mode === mode ? "true" : undefined}
            data-testid={`layout-mode-${mode}`}
            onClick={() => {
              mgr.handleLayoutModeChange(mode);
              setMenu(null);
            }}
          >
            <ModeIcon size={16} aria-hidden="true" />
            <span className="flex-1 text-left">{label}</span>
            {layout.mode === mode && <Check size={14} aria-hidden="true" />}
          </button>
        ))}
        <div className="sor-menu-divider" />
        <button
          type="button"
          role="menuitem"
          className="sor-menu-item w-full"
          aria-haspopup="dialog"
          aria-current={layout.mode === "customGrid" ? "true" : undefined}
          onClick={openCustomGrid}
        >
          <Settings2 size={16} aria-hidden="true" />
          <span className="flex-1 text-left">{customLabel}</span>
          {layout.mode === "customGrid" && (
            <Check size={14} aria-hidden="true" />
          )}
        </button>
        {hiddenSessions.length > 0 && (
          <>
            <div className="sor-menu-divider" />
            <div className="px-3 py-1.5 text-xs text-[var(--color-textMuted)]">
              {t(
                "session.tabLayout.hiddenMenuTitle",
                "Hidden sessions — click to promote",
              )}
            </div>
            {hiddenSessions.map((session) => (
              <button
                type="button"
                role="menuitem"
                key={session.id}
                className="sor-menu-item w-full"
                onClick={() => {
                  const activeSlot = layout.sessions.findIndex(
                    (slot) => slot.sessionId === activeSessionId,
                  );
                  mgr.assignSessionToSlot(session.id, Math.max(0, activeSlot));
                  onSessionSelect(session.id);
                  setMenu(null);
                }}
              >
                <Eye size={14} aria-hidden="true" />
                <span className="truncate">{session.name}</span>
              </button>
            ))}
          </>
        )}
      </MenuSurface>
      <PopoverSurface
        isOpen={mgr.showCustomGrid}
        onClose={() => mgr.setShowCustomGrid(false)}
        anchorRef={triggerRef}
        align="end"
        className="sor-popover-panel w-[256px] p-4"
        dataTestId="tab-layout-custom-grid-popover"
      >
        <div
          ref={gridRef}
          role="dialog"
          aria-label={t(
            "session.tabLayout.customGrid.title",
            "Custom Grid Layout",
          )}
          onKeyDown={(event) => {
            if (event.key !== "Tab") return;
            const items = Array.from(
              gridRef.current?.querySelectorAll<HTMLElement>("input, button") ??
                [],
            );
            if (event.shiftKey && document.activeElement === items[0]) {
              event.preventDefault();
              items[items.length - 1]?.focus();
            } else if (
              !event.shiftKey &&
              document.activeElement === items[items.length - 1]
            ) {
              event.preventDefault();
              items[0]?.focus();
            }
          }}
        >
          <div className="mb-3 text-sm font-medium text-[var(--color-text)]">
            {t("session.tabLayout.customGrid.title", "Custom Grid Layout")}
          </div>
          <div className="space-y-3">
            <div>
              <label
                htmlFor={`${gridId}-columns`}
                className="block text-xs text-[var(--color-textSecondary)]"
              >
                {t("session.tabLayout.customGrid.columns", "Columns")}
              </label>
              <div className="mt-1 flex items-center gap-2">
                <Slider
                  id={`${gridId}-columns`}
                  value={mgr.customCols}
                  onChange={mgr.setCustomCols}
                  min={1}
                  max={mgr.maxCustomGridDim}
                  className="flex-1"
                />
                <span className="w-6 text-sm text-[var(--color-text)]">
                  {mgr.customCols}
                </span>
              </div>
            </div>
            <div>
              <label
                htmlFor={`${gridId}-rows`}
                className="block text-xs text-[var(--color-textSecondary)]"
              >
                {t("session.tabLayout.customGrid.rows", "Rows")}
              </label>
              <div className="mt-1 flex items-center gap-2">
                <Slider
                  id={`${gridId}-rows`}
                  value={mgr.customRows}
                  onChange={mgr.setCustomRows}
                  min={1}
                  max={mgr.maxCustomGridDim}
                  className="flex-1"
                />
                <span className="w-6 text-sm text-[var(--color-text)]">
                  {mgr.customRows}
                </span>
              </div>
            </div>
            <div className="rounded border border-[var(--color-border)] p-2">
              <div
                className="grid gap-1"
                style={{
                  gridTemplateColumns: `repeat(${mgr.customCols}, 1fr)`,
                  gridTemplateRows: `repeat(${mgr.customRows}, 1fr)`,
                }}
              >
                {Array.from({ length: mgr.customCols * mgr.customRows }).map(
                  (_, i) => (
                    <div
                      key={i}
                      className={`h-4 rounded ${i < sessions.length ? "bg-primary" : "bg-[var(--color-surfaceHover)]"}`}
                    />
                  ),
                )}
              </div>
              <div className="mt-1 text-center text-xs text-[var(--color-textMuted)]">
                {mgr.customCols * mgr.customRows}{" "}
                {t("session.tabLayout.customGrid.tilesSuffix", "tiles ·")}{" "}
                {Math.min(sessions.length, mgr.customCols * mgr.customRows)}{" "}
                {t("session.tabLayout.customGrid.filledSuffix", "filled ·")}{" "}
                {connectionCount}{" "}
                {connectionCount === 1
                  ? t("session.tabLayout.customGrid.sessionOne", "session")
                  : t("session.tabLayout.customGrid.sessionOther", "sessions")}
              </div>
            </div>
            <button
              type="button"
              onClick={mgr.handleCustomGridApply}
              className="sor-btn sor-btn-primary w-full"
            >
              {t("session.tabLayout.customGrid.applyLayout", "Apply Layout")}
            </button>
          </div>
        </div>
      </PopoverSurface>
    </>
  );
}
