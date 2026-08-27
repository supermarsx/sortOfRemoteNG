// Nginx Proxy Manager "Open web UI (auto-login)" (t65-e4).
//
// Synthesises an ephemeral HTTP web-session `Connection` for NPM's own admin
// UI and hands it to the app's session-open path, re-using t20's proxy-side
// web auto-login (`httpAutoLogin` + `httpAutoLoginSelectors`) with NPM's
// login-form selectors pre-filled.
//
// Session-open path — mirrors t64-e4 (Portainer) verbatim: no integration
// panel opens a session today and `useSessionManager`'s `handleConnect` is not
// exported beyond `App.tsx` (t63 owns that file set). The connection is
// therefore (1) registered in the existing volatile runtime-connection
// registry (the Quick Connect mechanism — never persisted, released when the
// session closes) and (2) announced through the same window `CustomEvent`
// Portainer uses (`open-runtime-connection`, `source: "nginxProxyMgr"`). One
// listener in `App.tsx` / `useSessionManager.tsx` calling
// `handleConnect(detail.connection)` serves both integrations once t63 lands.

import type {
  Connection,
  HttpAutoLoginSelectors,
} from "../../../types/connection/connection";
import { registerRuntimeConnection } from "../../../utils/session/runtimeConnectionRegistry";
import type { NpmAuthMode } from "../../../types/nginxProxyMgr";

/** Window event carrying an ephemeral `Connection` to open as a session
 *  (shared name with Portainer's `PORTAINER_OPEN_WEB_UI_EVENT`). */
export const NPM_OPEN_WEB_UI_EVENT = "open-runtime-connection" as const;

export interface OpenRuntimeConnectionDetail {
  connection: Connection;
  source: "nginxProxyMgr";
}

/** NPM login view (`/login`): the inputs are named after the API's token
 *  request fields (`identity` / `secret`). Kept in ONE constant so a
 *  live-container check (t65-e5) can fix them in a single line. */
export const NPM_AUTO_LOGIN_SELECTORS: Readonly<HttpAutoLoginSelectors> =
  Object.freeze({
    usernameSelector: 'input[name="identity"]',
    passwordSelector: 'input[name="secret"]',
    submitSelector: 'button[type="submit"]',
  });

export interface NpmWebUiTarget {
  protocol: "http" | "https";
  hostname: string;
  port: number;
  useSsl: boolean;
}

/** Parse an NPM base/API URL into the host/port/scheme a web session needs.
 *  Missing scheme defaults to `http` (NPM's admin default is plain `:81`);
 *  missing port defaults to 81 (http) / 443 (https). */
export function parseNpmWebUiTarget(baseUrl: string): NpmWebUiTarget {
  const trimmed = baseUrl.trim();
  if (!trimmed) throw new Error("Nginx Proxy Manager URL is empty");
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `http://${trimmed}`;
  const url = new URL(withScheme);
  const scheme = url.protocol.replace(/:$/, "").toLowerCase();
  if (scheme !== "http" && scheme !== "https") {
    throw new Error(`Unsupported Nginx Proxy Manager URL scheme: ${scheme}`);
  }
  const useSsl = scheme === "https";
  const port = url.port ? Number(url.port) : useSsl ? 443 : 81;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid Nginx Proxy Manager port: ${url.port}`);
  }
  return {
    protocol: scheme,
    hostname: url.hostname.replace(/^\[|\]$/g, ""),
    port,
    useSsl,
  };
}

export interface BuildNpmWebUiConnectionInput {
  baseUrl: string;
  authMode: NpmAuthMode;
  email?: string | null;
  password?: string | null;
  /** Mirrors the panel's "Accept self-signed certificate" toggle. */
  skipTlsVerify?: boolean;
  /** Display name for the tab; defaults to `Nginx Proxy Manager (<host>)`. */
  name?: string;
  /** Injectable for tests. */
  id?: string;
  now?: () => string;
}

/** Build the ephemeral web-session connection. Password mode arms proxy-side
 *  auto-login with the credentials; token mode opens the UI WITHOUT
 *  auto-login (a bearer token cannot drive the login form) and never carries
 *  a password. */
export function buildNpmWebUiConnection(
  input: BuildNpmWebUiConnectionInput,
): Connection {
  const target = parseNpmWebUiTarget(input.baseUrl);
  const email = input.email?.trim() ?? "";
  const password = input.password ?? "";
  const canAutoLogin =
    input.authMode === "password" && email.length > 0 && password.length > 0;
  const stamp = (input.now ?? (() => new Date().toISOString()))();
  const id =
    input.id ??
    `npm-webui-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;

  const connection: Connection = {
    id,
    name: input.name?.trim() || `Nginx Proxy Manager (${target.hostname})`,
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port,
    isGroup: false,
    icon: "waypoints",
    createdAt: stamp,
    updatedAt: stamp,
    httpAutoLogin: canAutoLogin,
  };
  if (canAutoLogin) {
    connection.username = email;
    connection.password = password;
    connection.httpAutoLoginSelectors = { ...NPM_AUTO_LOGIN_SELECTORS };
  }
  if (target.useSsl && input.skipTlsVerify) {
    connection.httpVerifySsl = false;
  }
  return connection;
}

/** Register the ephemeral connection and announce it to the app shell.
 *  Returns the connection so callers/tests can inspect it. */
export function launchNpmWebUi(
  input: BuildNpmWebUiConnectionInput,
): Connection {
  const connection = buildNpmWebUiConnection(input);
  registerRuntimeConnection(connection);
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent<OpenRuntimeConnectionDetail>(NPM_OPEN_WEB_UI_EVENT, {
        detail: { connection, source: "nginxProxyMgr" },
      }),
    );
  }
  return connection;
}
