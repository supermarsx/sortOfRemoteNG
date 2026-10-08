import { useLayoutEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  ORIGIN_BROWSER_FIND_EVENT,
  type OriginBrowserIdentity,
  type OriginBrowserFindResult,
} from "../../types/protocols/originBrowser";

interface Options {
  identity: OriginBrowserIdentity | null;
  viewId: string | null;
  enabled: boolean;
  documentKey: string;
  assertOwner: () => void;
}

/** Subscribe before enabling search; no global listeners, polling, or storage. */
export function useOriginFindResults(options: Options) {
  const latest = useRef(options);
  const scope = JSON.stringify([
    options.identity?.ownerDatabaseId,
    options.identity?.connectionId,
    options.identity?.sessionId,
    options.identity?.attemptId,
    options.viewId,
    options.documentKey,
  ]);
  const [state, setState] = useState<{
    scope: string;
    ready: boolean;
    result: OriginBrowserFindResult | null;
  }>({ scope, ready: false, result: null });
  useLayoutEffect(() => {
    latest.current = options;
  });
  useLayoutEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    const { identity, viewId } = latest.current;
    setState({ scope, ready: false, result: null });
    const eligible = () => active && latest.current.enabled;
    const unavailable = () => {
      if (active) setState({ scope, ready: false, result: null });
    };
    const retire = () => {
      unavailable();
      active = false;
      unsubscribe?.();
      unsubscribe = undefined;
    };
    if (options.enabled && identity) {
      const captured = { ...identity };
      void (async () => {
        try {
          latest.current.assertOwner();
          const stop = await listen<unknown>(
            ORIGIN_BROWSER_FIND_EVENT,
            (event) => {
              if (!eligible()) return;
              try {
                latest.current.assertOwner();
              } catch {
                retire();
                return;
              }
              const payload = event.payload as {
                sourceIdentity?: OriginBrowserIdentity;
                viewId?: string | null;
                result?: OriginBrowserFindResult;
              } | null;
              const source = payload?.sourceIdentity;
              const result = payload?.result;
              if (
                !source ||
                source.ownerDatabaseId !== captured.ownerDatabaseId ||
                source.connectionId !== captured.connectionId ||
                source.sessionId !== captured.sessionId ||
                source.attemptId !== captured.attemptId ||
                payload?.viewId !== viewId ||
                !result ||
                typeof result.requestId !== "string" ||
                !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(
                  result.requestId,
                ) ||
                !Number.isInteger(result.numberOfMatches) ||
                result.numberOfMatches < 0 ||
                result.numberOfMatches > 2_147_483_647 ||
                !Number.isInteger(result.activeMatchOrdinal) ||
                result.activeMatchOrdinal < 0 ||
                result.activeMatchOrdinal > result.numberOfMatches ||
                typeof result.finalUpdate !== "boolean"
              )
                return;
              setState({
                scope,
                ready: true,
                result: {
                  requestId: result.requestId,
                  activeMatchOrdinal: result.activeMatchOrdinal,
                  numberOfMatches: result.numberOfMatches,
                  finalUpdate: result.finalUpdate,
                },
              });
            },
            {
              target: {
                kind: "WebviewWindow",
                label: getCurrentWebviewWindow().label,
              },
            },
          );
          unsubscribe = stop;
          if (!eligible()) {
            stop();
            unsubscribe = undefined;
            return;
          }
          latest.current.assertOwner();
          setState((current) => ({ ...current, scope, ready: true }));
        } catch {
          retire();
        }
      })();
    }
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [scope, options.enabled]);
  return options.enabled && state.scope === scope
    ? state
    : { ready: false, result: null };
}
