import { createContext } from "react";
import type { SetStateAction } from "react";

export interface SessionFullscreenController {
  activeSessionId: string | null;
  enterFullscreen: (sessionId: string) => void;
  exitFullscreen: (sessionId?: string) => void;
  setFullscreen: (
    sessionId: string,
    nextValue: SetStateAction<boolean>,
  ) => void;
  registerLifecycle: (
    sessionId: string,
    lifecycle: SessionFullscreenLifecycle,
  ) => () => void;
}

export interface SessionFullscreenLifecycle {
  onEnter?: () => void;
  onExit?: () => void;
}

export const SessionFullscreenContext =
  createContext<SessionFullscreenController | null>(null);
