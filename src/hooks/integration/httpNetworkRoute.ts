import type { Connection } from "../../types/connection/connection";
import type { RuntimeNetworkPath } from "../../utils/network/resolveRuntimeNetworkPath";
import { stableJsonStringify } from "../../utils/core/stableJsonStringify";
import {
  HttpNetworkRouteError,
  mergeHttpProxyRoutes,
} from "../../utils/network/httpProxyRoute";
import { getGlobalHttpProxyUrl } from "./httpProxy";

export interface HttpNetworkRoute {
  /** Ephemeral; may contain proxy credentials. Never persist or display. */
  upstreamProxyUrl: string | undefined;
  assertCurrent: () => void;
  redactError: (error: unknown) => string;
}

export function httpNetworkPathIdentity(connection?: Connection): string {
  return stableJsonStringify([
    connection?.id,
    connection?.proxyProfileId,
    connection?.proxyChainId,
    connection?.tunnelProfileId,
    connection?.tunnelChainId,
    connection?.connectionChainId,
    connection?.security?.proxy,
    connection?.security?.tunnelChain,
    connection?.security?.sshTunnel,
    connection?.security?.openvpn,
  ]);
}

/** Synchronous for the ordinary direct/global route: no catalog load or async gap. */
export function captureHttpNetworkRoute(
  runtime: RuntimeNetworkPath | null,
  currentConnection: () => Connection | undefined,
): HttpNetworkRoute {
  const identity = httpNetworkPathIdentity(currentConnection());
  const global = getGlobalHttpProxyUrl({ failClosed: true });
  const upstreamProxyUrl = mergeHttpProxyRoutes(
    runtime?.httpUpstreamProxyUrl,
    global,
  );
  const assertCurrent = () => {
    runtime?.assertCurrent?.();
    if (
      identity !== httpNetworkPathIdentity(currentConnection()) ||
      global !== getGlobalHttpProxyUrl({ failClosed: true })
    )
      throw new HttpNetworkRouteError(
        "The HTTP network route changed. Reload the connection before sending another request.",
      );
  };
  assertCurrent();
  const secrets = new Set(runtime?.redactionSecrets ?? []);
  if (upstreamProxyUrl) {
    const url = new URL(upstreamProxyUrl);
    secrets.add(upstreamProxyUrl);
    for (const value of [url.username, url.password]) {
      if (value) {
        secrets.add(value);
        secrets.add(decodeURIComponent(value));
      }
    }
  }
  const redactError = (error: unknown) =>
    [...secrets]
      .filter(Boolean)
      .sort((a, b) => b.length - a.length)
      .reduce(
        (message, secret) => message.split(secret).join("[redacted]"),
        error instanceof Error ? error.message : String(error),
      );
  return { upstreamProxyUrl, assertCurrent, redactError };
}
