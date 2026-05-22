/**
 * tabLayoutBuilder — single source of truth for translating a
 * `(mode, sessions, options)` triple into a concrete `TabLayout`.
 *
 * Previously, both `App.tsx` and `useTabLayoutManager.ts` had their
 * own copies of this logic that drifted in subtle ways (custom-grid
 * mode being silently re-tagged as `mosaic`, session-change effect
 * rebuilding layouts under a different mode than the toolbar chose,
 * etc.). All callers now go through `buildTabLayout` so the rules
 * are encoded in one place.
 *
 * Positions are *derived* from `(mode, sessionCount)`; we never
 * round-trip them through settings. The mode plus the custom grid
 * dimensions (when applicable) are all the state needed to recompute
 * the layout deterministically.
 */

import type {
  ConnectionSession,
  TabLayout,
  TabLayoutMode,
} from '../../types/connection/connection';

export const TAB_LAYOUT_MODES: readonly TabLayoutMode[] = [
  'tabs',
  'sideBySide',
  'mosaic',
  'miniMosaic',
  'splitVertical',
  'splitHorizontal',
  'grid2',
  'grid4',
  'grid6',
  'customGrid',
] as const;

export const MAX_CUSTOM_GRID_DIM = 6;
export const MIN_CUSTOM_GRID_DIM = 1;

export interface BuildTabLayoutOptions {
  /** When provided, the active session is moved to slot 0 so the
   *  user's current focus stays in the most prominent tile. */
  activeSessionId?: string;
  /** Custom-grid dimensions. Required when `mode === 'customGrid'`. */
  customCols?: number;
  customRows?: number;
}

/**
 * Clamp a custom-grid dimension to the supported range. Values
 * outside `[MIN_CUSTOM_GRID_DIM, MAX_CUSTOM_GRID_DIM]` would either
 * render uselessly (0 cols) or collapse the UI (50+ cols), so we
 * normalize here rather than trusting persisted state.
 */
export function clampGridDim(value: number | undefined): number {
  if (!Number.isFinite(value) || value === undefined) {
    return 2;
  }
  return Math.max(
    MIN_CUSTOM_GRID_DIM,
    Math.min(MAX_CUSTOM_GRID_DIM, Math.floor(value)),
  );
}

function orderSessions(
  sessions: ConnectionSession[],
  activeSessionId?: string,
): ConnectionSession[] {
  if (!activeSessionId) return sessions;
  const active = sessions.find((s) => s.id === activeSessionId);
  if (!active) return sessions;
  return [active, ...sessions.filter((s) => s.id !== activeSessionId)];
}

interface GridSpec {
  cols: number;
  rows: number;
  /** Slice the session list to this many before laying out. */
  cap?: number;
}

/**
 * Resolve a mode → grid spec, given the available session count
 * and custom-grid dimensions. Centralized so the cap rules
 * (e.g. grid4 hides anything past 4) are documented in one place.
 */
function specFor(
  mode: TabLayoutMode,
  sessionCount: number,
  opts: BuildTabLayoutOptions,
): GridSpec {
  switch (mode) {
    case 'tabs':
      return { cols: 1, rows: 1 };
    case 'splitVertical': {
      const cols = 2;
      return { cols, rows: Math.max(1, Math.ceil(sessionCount / cols)) };
    }
    case 'splitHorizontal': {
      const rows = 2;
      return { cols: Math.max(1, Math.ceil(sessionCount / rows)), rows };
    }
    case 'grid2':
      return { cols: 2, rows: 1, cap: 2 };
    case 'grid4':
      return { cols: 2, rows: 2, cap: 4 };
    case 'grid6':
      return { cols: 3, rows: 2, cap: 6 };
    case 'sideBySide': {
      const cols = 2;
      return { cols, rows: Math.max(1, Math.ceil(sessionCount / cols)) };
    }
    case 'mosaic':
    case 'miniMosaic': {
      const cols = Math.max(1, Math.ceil(Math.sqrt(sessionCount)) || 1);
      const rows = Math.max(1, Math.ceil(sessionCount / cols));
      return { cols, rows };
    }
    case 'customGrid': {
      const cols = clampGridDim(opts.customCols);
      const rows = clampGridDim(opts.customRows);
      return { cols, rows, cap: cols * rows };
    }
    default: {
      // Exhaustiveness check — if a new mode is added to the union
      // but not to the switch, TS will flag this assignment.
      const _exhaustive: never = mode;
      void _exhaustive;
      return { cols: 1, rows: 1 };
    }
  }
}

/**
 * Build a `TabLayout` from a mode + session list.
 *
 * - When `mode === 'tabs'`, sessions all share the full container;
 *   the renderer toggles visibility on the active one.
 * - When `mode === 'miniMosaic'`, the renderer hides all session
 *   panes and shows a preview grid instead, but we still emit
 *   positions so a click-to-promote handler can pick a slot.
 * - Otherwise positions are arranged in a `(cols × rows)` grid.
 *   `cap` truncates the session list when the mode advertises a
 *   fixed capacity (grid2/4/6, customGrid). Sessions past the cap
 *   are *not* included in `layout.sessions` — the renderer hides
 *   them and a "+N hidden" indicator surfaces them to the user.
 */
export function buildTabLayout(
  mode: TabLayoutMode,
  sessions: ConnectionSession[],
  opts: BuildTabLayoutOptions = {},
): TabLayout {
  const ordered = orderSessions(sessions, opts.activeSessionId);

  // `tabs` and `miniMosaic` don't lay out tiles — the renderer
  // either shows one session full-bleed (tabs) or shows a preview
  // grid that doesn't read positions (miniMosaic). Emitting (0,0,
  // 100,100) for every session keeps position semantics consistent
  // for any code that walks `layout.sessions`.
  if (mode === 'tabs' || mode === 'miniMosaic') {
    return {
      mode,
      sessions: ordered.map((session) => ({
        sessionId: session.id,
        position: { x: 0, y: 0, width: 100, height: 100 },
      })),
    };
  }

  const spec = specFor(mode, ordered.length, opts);
  const positioned = spec.cap != null ? ordered.slice(0, spec.cap) : ordered;

  const colWidth = 100 / spec.cols;
  const rowHeight = 100 / spec.rows;

  const layout: TabLayout = {
    mode,
    sessions: positioned.map((session, index) => {
      const colIndex = index % spec.cols;
      const rowIndex = Math.floor(index / spec.cols);
      return {
        sessionId: session.id,
        position: {
          x: colIndex * colWidth,
          y: rowIndex * rowHeight,
          width: colWidth,
          height: rowHeight,
        },
      };
    }),
  };

  if (mode === 'customGrid') {
    layout.customCols = clampGridDim(opts.customCols);
    layout.customRows = clampGridDim(opts.customRows);
  }

  return layout;
}

/**
 * How many sessions does this layout actually display? Anything
 * beyond `visibleSlotCount` is hidden in mosaic modes (grid2/4/6,
 * customGrid). The toolbar uses this to render the "+N hidden"
 * indicator.
 */
export function visibleSlotCount(layout: TabLayout): number {
  return layout.sessions.length;
}

/**
 * The maximum number of session slots this layout's mode supports.
 * For capped modes (grid2/4/6, customGrid) this is fixed. For
 * uncapped modes it scales with `sessionCount` so callers can
 * compare against the actual session list and detect whether a
 * rebuild is needed.
 */
export function layoutCapacity(
  layout: TabLayout,
  sessionCount: number,
): number {
  switch (layout.mode) {
    case 'grid2':
      return 2;
    case 'grid4':
      return 4;
    case 'grid6':
      return 6;
    case 'customGrid':
      return clampGridDim(layout.customCols) * clampGridDim(layout.customRows);
    default:
      return sessionCount;
  }
}

/**
 * True when the layout has slots that aren't filled yet, given a
 * particular session count. Used by the session-sync effect to
 * decide whether opening a new session should trigger a rebuild
 * (filling an empty slot) or just be ignored (mode is at capacity).
 */
export function hasFreeSlot(
  layout: TabLayout,
  sessionCount: number,
): boolean {
  return layout.sessions.length < Math.min(sessionCount, layoutCapacity(layout, sessionCount));
}

/**
 * Is this a mode that fills the container with tiles? Used by the
 * renderer to decide between the tabs-style stacked overlay and the
 * mosaic tile renderer.
 */
export function isMosaicMode(mode: TabLayoutMode): boolean {
  return mode !== 'tabs' && mode !== 'miniMosaic';
}
