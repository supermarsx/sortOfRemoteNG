import { createContext } from "react";
import type { ValueStore } from "./valueStore";
import type { SettingsContextType } from "./SettingsContext";

/** Selector-store mirror of the settings context value (see useSettingsSelector). */
export const SettingsStoreContext =
  createContext<ValueStore<SettingsContextType> | null>(null);
