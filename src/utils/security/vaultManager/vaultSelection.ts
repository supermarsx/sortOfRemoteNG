export interface VaultSelection {
  keys: ReadonlySet<string>;
  anchor: string | null;
  /** The row most recently acted on; arrow keys move from here. */
  focus: string | null;
}
export const EMPTY_SELECTION: VaultSelection = {
  keys: new Set(),
  anchor: null,
  focus: null,
};

export interface SelectGesture {
  ctrl?: boolean;
  shift?: boolean;
}

/** KeePass-style selection: click, Ctrl+click toggles, Shift+click ranges. */
export function selectRow(
  state: VaultSelection,
  key: string,
  gesture: SelectGesture,
  ordered: readonly string[],
): VaultSelection {
  if (gesture.shift && state.anchor !== null) {
    const from = ordered.indexOf(state.anchor);
    const to = ordered.indexOf(key);
    if (from >= 0 && to >= 0) {
      const [a, b] = from < to ? [from, to] : [to, from];
      const range = ordered.slice(a, b + 1);
      return {
        keys: new Set(gesture.ctrl ? [...state.keys, ...range] : range),
        anchor: state.anchor,
        focus: key,
      };
    }
  }
  if (gesture.ctrl) {
    const next = new Set(state.keys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return { keys: next, anchor: key, focus: key };
  }
  return { keys: new Set([key]), anchor: key, focus: key };
}

export function selectAll(ordered: readonly string[]): VaultSelection {
  return {
    keys: new Set(ordered),
    anchor: ordered[0] ?? null,
    focus: ordered[ordered.length - 1] ?? null,
  };
}

/** Keep only keys that still exist after a filter, reload or delete. */
export function pruneSelection(
  state: VaultSelection,
  ordered: readonly string[],
): VaultSelection {
  const live = new Set(ordered);
  const kept = [...state.keys].filter((key) => live.has(key));
  if (
    kept.length === state.keys.size &&
    (state.focus === null || live.has(state.focus))
  )
    return state;
  return {
    keys: new Set(kept),
    anchor:
      state.anchor !== null && live.has(state.anchor) ? state.anchor : null,
    focus: state.focus !== null && live.has(state.focus) ? state.focus : null,
  };
}

/** Arrow-key movement; Shift extends the range from the anchor. */
export function moveSelection(
  state: VaultSelection,
  ordered: readonly string[],
  delta: number,
  extend: boolean,
): VaultSelection {
  if (!ordered.length) return state;
  const at = state.focus === null ? -1 : ordered.indexOf(state.focus);
  const next = ordered[Math.max(0, Math.min(ordered.length - 1, at + delta))];
  return selectRow(state, next, { shift: extend }, ordered);
}
