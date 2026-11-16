import { useContext } from "react";
import type { ConnectionContextType } from "./ConnectionContextTypes";
import { ConnectionStoreContext } from "./connectionStoreContext";
import { useConnections } from "./useConnections";
import { useStoreSelector } from "./valueStore";

/**
 * Read a slice of the connection context. Re-renders only when the selected
 * value changes (per `isEqual`, default `Object.is`), unlike `useConnections()`
 * which re-renders on every connection/session/selection change.
 *
 * Falls back to `useConnections()` when no provider-backed store exists (tests
 * that supply `ConnectionContext.Provider` directly); that never changes for
 * the lifetime of a component, so the conditional hook is stable.
 */
export function useConnectionsSelector<S>(
  selector: (value: ConnectionContextType) => S,
  isEqual?: (a: S, b: S) => boolean,
): S {
  const store = useContext(ConnectionStoreContext);
  if (store) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useStoreSelector(store, selector, isEqual);
  }
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return selector(useConnections());
}
