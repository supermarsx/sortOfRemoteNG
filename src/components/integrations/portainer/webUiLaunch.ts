// Portainer "Open web UI (auto-login)" (t64-e4).
//
// Synthesises an ephemeral HTTP web-session `Connection` for Portainer's own UI
// and hands it to the app's session-open path, re-using t20's proxy-side web
// auto-login (`httpAutoLogin` + `httpAutoLoginSelectors`) with Portainer's
// login-form selectors pre-filled.
//
// Session-open path: no integration panel opens a session today and
// `useSessionManager`'s `handleConnect` is not exported beyond `App.tsx`
// (t63 owns that file set). The connection is therefore (1) registered in the
// existing volatile runtime-connection registry (the Quick Connect mechanism —
// never persisted, released when the session closes) and (2) announced through
// a window `CustomEvent` (`PORTAINER_OPEN_WEB_UI_EVENT`), the same pattern
// `split-session` uses between `SessionViewer` and `App.tsx`. A listener that
// calls `handleConnect(detail.connection)` must be added in `App.tsx` /
// `useSessionManager.tsx` once t63 lands — flagged in the t64-e4 log.

import type {
  Connection,
  HttpAutoLoginSelectors,
} from "../../../types/connection/connection";
import { registerRuntimeConnection } from "../../../utils/session/runtimeConnectionRegistry";
import type { PortainerAuthMode } from "../../../types/portainer";

/** Window event carrying an ephemeral `Connection` to open as a session. */
export const PORTAINER_OPEN_WEB_UI_EVENT = "open-runtime-connection" as const;

export interface OpenRuntimeConnectionDetail {
  connection: Connection;
  source: "portainer";
}

/** Portainer CE/BE login form (`/#!/auth`): `input#username`,
 *  `input#password`, primary `button[type=submit]`. Stable since 2.x. */
export const PORTAINER_AUTO_LOGIN_SELECTORS: Readonly<HttpAutoLoginSelectors> =
  Object.freeze({
    usernameSelector: "input#username",
    passwordSelector: "input#password",
    submitSelector: "button[type=submit]",
  });

export interface PortainerWebUiTarget {
  protocol: "http" | "https";
  hostname: string;
  port: number;
  useSsl: boolean;
}

/** Parse a Portainer base URL into the host/port/scheme a web session needs.
 *  Missing scheme defaults to `https` (Portainer's default is `:9443` TLS);
 *  missing port defaults to 9443 (https) / 9000 (http). */
export function parsePortainerWebUiTarget(
  baseUrl: string,
): PortainerWebUiTarget {
  const trimmed = baseUrl.trim();
  if (!trimmed) throw new Error("Portainer base URL is empty");
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  const url = new URL(withScheme);
  const scheme = url.protocol.replace(/:$/, "").toLowerCase();
  if (scheme !== "http" && scheme !== "https") {
    throw new Error(`Unsupported Portainer URL scheme: ${scheme}`);
  }
  const useSsl = scheme === "https";
  const port = url.port ? Number(url.port) : useSsl ? 9443 : 9000;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid Portainer port: ${url.port}`);
  }
  return {
    protocol: scheme,
    hostname: url.hostname.replace(/^\[|\]$/g, ""),
    port,
    useSsl,
  };
}

export interface BuildPortainerWebUiConnectionInput {
  baseUrl: string;
  authMode: PortainerAuthMode;
  username?: string | null;
  password?: string | null;
  /** Mirrors the panel's "Accept self-signed certificate" toggle. */
  skipTlsVerify?: boolean;
  /** Display name for the tab; defaults to `Portainer (<host>)`. */
  name?: string;
  /** Injectable for tests. */
  id?: string;
  now?: () => string;
}

/** Build the ephemeral web-session connection. Password mode arms proxy-side
 *  auto-login with the credentials; API-key mode opens the UI WITHOUT
 *  auto-login (a Portainer access token cannot drive the login form) and
 *  never carries a password. */
export function buildPortainerWebUiConnection(
  input: BuildPortainerWebUiConnectionInput,
): Connection {
  const target = parsePortainerWebUiTarget(input.baseUrl);
  const username = input.username?.trim() ?? "";
  const password = input.password ?? "";
  const canAutoLogin =
    input.authMode === "password" && username.length > 0 && password.length > 0;
  const stamp = (input.now ?? (() => new Date().toISOString()))();
  const id =
    input.id ??
    `portainer-webui-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;

  const connection: Connection = {
    id,
    name: input.name?.trim() || `Portainer (${target.hostname})`,
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port,
    isGroup: false,
    icon: "container",
    createdAt: stamp,
    updatedAt: stamp,
    httpAutoLogin: canAutoLogin,
  };
  if (canAutoLogin) {
    connection.username = username;
    connection.password = password;
    connection.httpAutoLoginSelectors = { ...PORTAINER_AUTO_LOGIN_SELECTORS };
  }
  if (target.useSsl && input.skipTlsVerify) {
    connection.httpVerifySsl = false;
  }
  return connection;
}

/** Register the ephemeral connection and announce it to the app shell.
 *  Returns the connection so callers/tests can inspect it. */
export function launchPortainerWebUi(
  input: BuildPortainerWebUiConnectionInput,
): Connection {
  const connection = buildPortainerWebUiConnection(input);
  registerRuntimeConnection(connection);
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent<OpenRuntimeConnectionDetail>(
        PORTAINER_OPEN_WEB_UI_EVENT,
        { detail: { connection, source: "portainer" } },
      ),
    );
  }
  return connection;
}
