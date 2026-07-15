import { useCallback, useMemo, useRef } from "react";

/**
 * Keeps synchronous controlled-editor changes composable until the parent
 * renders the emitted value back. The returned object is a read-only live view
 * so callbacks captured by a section always spread the latest emitted state.
 */
export function useComposedControlledValue<T extends object>(
  value: T,
  onChange: (value: T) => void,
): readonly [T, (value: T) => void] {
  const latest = useRef(value);
  const onChangeRef = useRef(onChange);

  // A committed parent render remains authoritative for this controlled value.
  latest.current = value;
  onChangeRef.current = onChange;

  const liveValue = useMemo(
    () =>
      new Proxy({} as T, {
        get: (_target, property) => Reflect.get(latest.current, property),
        has: (_target, property) => Reflect.has(latest.current, property),
        ownKeys: () => Reflect.ownKeys(latest.current),
        getOwnPropertyDescriptor: (_target, property) => {
          const descriptor = Reflect.getOwnPropertyDescriptor(
            latest.current,
            property,
          );
          return descriptor ? { ...descriptor, configurable: true } : undefined;
        },
      }),
    [],
  );

  const emit = useCallback((nextValue: T) => {
    latest.current = nextValue;
    onChangeRef.current(nextValue);
  }, []);

  return [liveValue, emit] as const;
}
