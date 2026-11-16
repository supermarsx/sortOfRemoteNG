import { createContext } from "react";
import type { ValueStore } from "./valueStore";
import type { ConnectionContextType } from "./ConnectionContextTypes";

/** Selector-store mirror of the connection context value (see useConnectionsSelector). */
export const ConnectionStoreContext =
  createContext<ValueStore<ConnectionContextType> | null>(null);
