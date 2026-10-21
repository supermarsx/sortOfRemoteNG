import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Connection } from "../../types/connection/connection";
import type { OriginBrowserState } from "./useOriginBrowser";
import {
  parseNativeBrowserDiagnostics,
  type NativeBrowserSessionDiagnostics,
} from "../../types/network/nativeBrowserDiagnostics";
import { getInvoke } from "../../utils/tauri/invoke";
import { nativeBrowserAuthoritySignature } from "../../utils/connection/nativeBrowserAuthoritySignature";
import { captureNetworkPathCatalog } from "../../utils/network/resolveRuntimeNetworkPath";
import { resolveNetworkPath } from "../../utils/network/resolveNetworkPath";
import {
  configuredOriginRouteHops,
  deriveOriginConnectionHealth,
  summarizedOriginRouteHops,
  type OriginConnectionHealth,
} from "../../utils/protocol/originConnectionHealth";

export interface OriginConnectionHealthOptions {
  connection?: Connection;
  connections?: readonly Connection[];
  state: OriginBrowserState;
  enabled: boolean;
  assertOwner: () => void;
}

/** Passive owner-scoped observations only. Never opens a socket, probes a URL,
 * acquires credentials or sets up a tunnel. Each response is fenced to its attempt. */
export function useOriginConnectionHealth(
  options: OriginConnectionHealthOptions,
): OriginConnectionHealth {
  const identity = options.state.snapshot?.identity;
  const connectionKey = useMemo(
    () =>
      options.connection
        ? nativeBrowserAuthoritySignature(options.connection)
        : "",
    [options.connection],
  );
  const connectionsKey = useMemo(
    () =>
      (options.connections ?? [])
        .map((row) =>
          JSON.stringify([nativeBrowserAuthoritySignature(row), row.name]),
        )
        .join(":"),
    [options.connections],
  );
  const key = JSON.stringify([
    identity,
    connectionKey,
    connectionsKey,
    options.enabled,
  ]);
  const current = useRef({ ...options, key });
  useLayoutEffect(() => {
    current.current = { ...options, key };
  });
  const [reading, setReading] = useState<{
    key: string;
    observation: NativeBrowserSessionDiagnostics | null;
    hops: OriginConnectionHealth["hops"] | null;
  }>({ key, observation: null, hops: null });
  const visible = configuredOriginRouteHops(options.connection).length > 0;
  useLayoutEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    setReading({ key, observation: null, hops: null });
    const start = current.current;
    if (!start.enabled || !visible) return;
    const identity = start.state.snapshot?.identity;
    const valid = () =>
      active && current.current.key === key && current.current.enabled;
    const owner = () => {
      if (!valid()) throw new Error("Connection health scope changed");
      current.current.assertOwner();
    };
    // Metadata expansion uses the same saved route order as the editor. It does
    // not resolve vault entries or invoke any connect/probe command.
    if (start.connection)
      void (async () => {
        owner();
        const catalog = await captureNetworkPathCatalog(
          start.connection!,
          start.connections ?? [],
        );
        owner();
        const resolution = resolveNetworkPath(start.connection!, catalog, {
          allowUnresolvedVaultHops: true,
        });
        const hops = summarizedOriginRouteHops(
          resolution.summary,
          start.connections,
          start.connection,
        );
        setReading((previous) =>
          previous.key === key ? { ...previous, hops } : previous,
        );
      })().catch(() => {
        /* Saved placeholders remain unknown, never direct. */
      });
    const poll = async () => {
      try {
        owner();
        if (!identity) return;
        const invoke = await getInvoke();
        owner();
        if (!invoke) return;
        let expired = false;
        // A stuck/late IPC must not keep old green health visible indefinitely.
        deadline = setTimeout(() => {
          expired = true;
          if (valid())
            setReading((previous) =>
              previous.key === key
                ? { ...previous, observation: null }
                : previous,
            );
        }, 5000);
        const data = parseNativeBrowserDiagnostics(
          await invoke("origin_browser_session_diagnostics"),
        );
        owner();
        if (expired) return;
        const observation =
          data.sessions.find(
            (row) =>
              row.identity.attemptId === identity.attemptId &&
              row.identity.connectionId === identity.connectionId &&
              row.identity.sessionId === identity.sessionId,
          ) ?? null;
        setReading((previous) =>
          previous.key === key ? { ...previous, observation } : previous,
        );
      } catch {
        if (valid())
          setReading((previous) =>
            previous.key === key
              ? { ...previous, observation: null }
              : previous,
          );
      } finally {
        clearTimeout(deadline);
        if (valid() && identity)
          timer = setTimeout(() => {
            void poll();
          }, 3000);
      }
    };
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
      clearTimeout(deadline);
    };
  }, [key, visible]);
  const observation = reading.key === key ? reading.observation : null;
  return deriveOriginConnectionHealth({
    ...options,
    observation,
    routeHops: reading.key === key ? reading.hops : null,
  });
}
