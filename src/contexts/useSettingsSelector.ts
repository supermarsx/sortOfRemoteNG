import { useContext } from "react";
import { useSettings, type SettingsContextType } from "./SettingsContext";
import { SettingsStoreContext } from "./settingsStoreContext";
import { useStoreSelector } from "./valueStore";

/**
 * Read a slice of the settings context. Re-renders only when the selected
 * value changes (per `isEqual`, default `Object.is`), unlike `useSettings()`
 * which re-renders on every settings change.
 *
 * Outside a provider-backed store (tests that mock `useSettings`), falls back
 * to `useSettings()`; whether a store exists never changes for the lifetime of
 * a component, so the conditional hook below is stable.
 */
export function useSettingsSelector<S>(
  selector: (value: SettingsContextType) => S,
  isEqual?: (a: S, b: S) => boolean,
): S {
  const store = useContext(SettingsStoreContext);
  if (store) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useStoreSelector(store, selector, isEqual);
  }
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return selector(useSettings());
}
