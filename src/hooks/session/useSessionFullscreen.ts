import {
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  SessionFullscreenContext,
  type SessionFullscreenLifecycle,
} from "../../contexts/SessionFullscreenContext";

export function useSessionFullscreenController() {
  return useContext(SessionFullscreenContext);
}

export function useSessionFullscreen(
  sessionId: string,
  lifecycle: SessionFullscreenLifecycle = {},
) {
  const controller = useSessionFullscreenController();
  const activeSessionId = controller?.activeSessionId;
  const exitFullscreen = controller?.exitFullscreen;
  const controllerSetFullscreen = controller?.setFullscreen;
  const registerLifecycle = controller?.registerLifecycle;
  const [standaloneFullscreen, setStandaloneFullscreen] = useState(false);
  const standaloneFullscreenRef = useRef(false);
  const isFullscreen = controller
    ? activeSessionId === sessionId
    : standaloneFullscreen;

  const setIsFullscreen = useCallback<Dispatch<SetStateAction<boolean>>>(
    (nextValue) => {
      if (controllerSetFullscreen) {
        controllerSetFullscreen(sessionId, nextValue);
        return;
      }

      const current = standaloneFullscreenRef.current;
      const next =
        typeof nextValue === "function" ? nextValue(current) : nextValue;
      if (next === current) return;
      standaloneFullscreenRef.current = next;
      setStandaloneFullscreen(next);
      if (next) lifecycle.onEnter?.();
      else lifecycle.onExit?.();
    },
    [controllerSetFullscreen, lifecycle, sessionId],
  );

  const toggleFullscreen = useCallback(
    () => setIsFullscreen((current) => !current),
    [setIsFullscreen],
  );

  useEffect(
    () =>
      registerLifecycle?.(sessionId, {
        onEnter: lifecycle.onEnter,
        onExit: lifecycle.onExit,
      }),
    [lifecycle.onEnter, lifecycle.onExit, registerLifecycle, sessionId],
  );

  useEffect(
    () => () => {
      exitFullscreen?.(sessionId);
    },
    [exitFullscreen, sessionId],
  );

  return { isFullscreen, setIsFullscreen, toggleFullscreen };
}
