import { useRef, useSyncExternalStore } from "react";

/**
 * Tiny external value store used to give context-backed state a selector API.
 * A provider keeps its normal React context value and mirrors it into one of
 * these; consumers that only need a slice subscribe through
 * `useStoreSelector` and re-render only when that slice changes.
 */
export interface ValueStore<T> {
  get(): T;
  set(next: T): void;
  subscribe(listener: () => void): () => void;
}

export function createValueStore<T>(initial: T): ValueStore<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next) {
      if (Object.is(next, value)) return;
      value = next;
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (
    typeof a !== "object" ||
    typeof b !== "object" ||
    a === null ||
    b === null
  )
    return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const key of ka) {
    if (
      !Object.prototype.hasOwnProperty.call(b, key) ||
      !Object.is(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key],
      )
    )
      return false;
  }
  return true;
}

/**
 * Subscribe to a slice of a store. The selected value keeps its previous
 * identity while `isEqual` says it did not change, so object/array selections
 * do not cause extra renders.
 */
export function useStoreSelector<T, S>(
  store: ValueStore<T>,
  selector: (value: T) => S,
  isEqual: (a: S, b: S) => boolean = Object.is,
): S {
  const selectorRef = useRef(selector);
  selectorRef.current = selector;
  const equalRef = useRef(isEqual);
  equalRef.current = isEqual;
  const last = useRef<{
    source: T;
    selector: (value: T) => S;
    selected: S;
  } | null>(null);
  const getSnapshot = (): S => {
    const source = store.get();
    const prev = last.current;
    const select = selectorRef.current;
    if (prev && Object.is(prev.source, source) && prev.selector === select)
      return prev.selected;
    const selected = select(source);
    if (prev && equalRef.current(prev.selected, selected)) {
      last.current = { source, selector: select, selected: prev.selected };
      return prev.selected;
    }
    last.current = { source, selector: select, selected };
    return selected;
  };
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}
