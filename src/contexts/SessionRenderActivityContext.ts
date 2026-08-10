import { createContext, useContext } from "react";

export interface SessionRenderActivityValue {
  /** The viewer is currently visible and may mutate its renderer. */
  isActive: boolean;
}

export const SessionRenderActivityContext =
  createContext<SessionRenderActivityValue>({
    // Viewers outside TabLayoutManager (for example a detached active viewer)
    // retain their existing active behavior.
    isActive: true,
  });

export const useSessionRenderActivity = (): SessionRenderActivityValue =>
  useContext(SessionRenderActivityContext);
