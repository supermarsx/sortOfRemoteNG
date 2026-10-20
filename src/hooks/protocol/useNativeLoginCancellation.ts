import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface NativeLoginCancellationTarget {
  ownerDatabaseId: string;
  connectionId: string;
  sessionId: string;
  attemptId: string;
}

/** Stop only this exact attempt. Never close the tab, retry, or change saved login consent. */
export function useNativeLoginCancellation(
  target: NativeLoginCancellationTarget | null,
) {
  const identity = target && {
    ownerDatabaseId: target.ownerDatabaseId,
    connectionId: target.connectionId,
    sessionId: target.sessionId,
    attemptId: target.attemptId,
  };
  const key = JSON.stringify(identity);
  const current = useRef({ key, target: identity });
  const mounted = useRef(false);
  const epoch = useRef(0);
  const pending = useRef<string | null>(null);
  const [state, setState] = useState({
    key,
    busy: false,
    done: false,
    message: "",
  });
  useLayoutEffect(() => {
    current.current = {
      key,
      target: JSON.parse(key) as NativeLoginCancellationTarget | null,
    };
    ++epoch.current;
    pending.current = null;
    setState({ key, busy: false, done: false, message: "" });
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, [key]);
  const cancel = useCallback(async () => {
    const captured = current.current;
    const generation = epoch.current;
    if (
      !mounted.current ||
      !captured.target ||
      pending.current === captured.key
    )
      return;
    pending.current = captured.key;
    setState({ key: captured.key, busy: true, done: false, message: "" });
    const live = () =>
      mounted.current &&
      epoch.current === generation &&
      current.current.key === captured.key;
    try {
      const cancelled = await invoke<boolean>("origin_browser_cancel_login", {
        request: { identity: captured.target, reason: "user-cancelled" },
      });
      if (cancelled !== true && cancelled !== false)
        throw new Error("Invalid cancellation receipt.");
      if (live())
        setState({
          key: captured.key,
          busy: false,
          done: true,
          message: cancelled
            ? "Automatic login cancelled. You can continue manually."
            : "This automatic-login attempt has already ended or changed.",
        });
    } catch {
      if (live()) {
        pending.current = null;
        setState({
          key: captured.key,
          busy: false,
          done: false,
          message:
            "Automatic login cancellation was not confirmed. Check the current login status before trying again.",
        });
      }
    }
  }, []);
  return {
    cancel,
    busy: state.key === key && state.busy,
    message: state.key === key ? state.message : "",
    available: target !== null && !(state.key === key && state.done),
  };
}
