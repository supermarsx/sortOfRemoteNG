// Proxmox VE "Open web UI" (t67-e4, plan §3 D5) — mirrors t64's Portainer
// launcher.
//
// Builds an ephemeral `https` web-session `Connection` for the PVE web UI and
// hands it to the app's session-open path. Password mode arms the proxy-side
// web auto-login (`httpAutoLogin` + `httpAutoLoginSelectors`) with the PVE
// ExtJS login window's selectors; API-token mode opens the UI WITHOUT
// auto-login and never carries a password (a token cannot drive the form).
//
// Session-open path: identical to Portainer — the connection is registered in
// the volatile runtime-connection registry (Quick Connect mechanism, never
// persisted) and announced through the shared `open-runtime-connection`
// window event (`source: "proxmox"`). The app-shell listener that calls
// `handleConnect(detail.connection)` is owned by t63/App.tsx (see the t64-e4
// log); this module never touches `useSessionManager.tsx`.
//
// Selectors verified against pve-manager `www/manager6/window/LoginWindow.js`
// (not a live node): ExtJS renders the form fields as `<input name="username">`,
// `<input name="password">`, the realm combobox as `<input name="realm">`, and
// the Login button as `<a role="button" class="x-btn …">` inside the login
// window (`div.x-window`). `user@realm` typed into the username is split by
// the login window itself (`onLogin`: `uname.indexOf('@')`), so the realm is
// carried in the username rather than through the combobox.

import { invoke } from "@tauri-apps/api/core";
import type {
  Connection,
  HttpAutoLoginSelectors,
} from "../../../types/connection/connection";
import { registerRuntimeConnection } from "../../../utils/session/runtimeConnectionRegistry";

/** Window event carrying an ephemeral `Connection` to open as a session
 *  (shared name with the Portainer launcher so one app-shell listener serves both). */
export const PROXMOX_OPEN_WEB_UI_EVENT = "open-runtime-connection" as const;

export interface OpenRuntimeConnectionDetail {
  connection: Connection;
  source: "proxmox";
}

export const PROXMOX_AUTO_LOGIN_SELECTORS: Readonly<HttpAutoLoginSelectors> =
  Object.freeze({
    usernameSelector: 'input[name="username"]',
    passwordSelector: 'input[name="password"]',
    submitSelector: 'div.x-window a.x-btn[role="button"]',
  });

export type ProxmoxWebUiAuthMode = "password" | "apitoken";

export interface ProxmoxWebUiTarget {
  kind: "qemu" | "lxc" | "node" | "storage";
  id: string;
  /** Node hosting the guest/storage (needed for qemu/lxc/storage deep links). */
  node?: string;
}

export interface BuildProxmoxWebUiConnectionInput {
  host: string;
  port?: number;
  authMode: ProxmoxWebUiAuthMode;
  /** `user@realm` (realm appended from `realm` when the username has none). */
  username?: string | null;
  realm?: string | null;
  password?: string | null;
  /** Mirrors the panel's "Accept self-signed certificates" toggle. */
  insecure?: boolean;
  /** Optional deep link (`#v1:0:=qemu%2F<vmid>`). */
  target?: ProxmoxWebUiTarget | null;
  /** Display name for the tab; defaults to `Proxmox VE (<host>)`. */
  name?: string;
  /** Injectable for tests. */
  id?: string;
  now?: () => string;
}

/** Ensure `user@realm` (PVE needs the realm to log in). */
export function qualifyUsername(
  username: string | null | undefined,
  realm: string | null | undefined,
): string {
  const user = (username ?? "").trim();
  if (!user) return "";
  if (user.includes("@")) return user;
  return `${user}@${(realm ?? "").trim() || "pam"}`;
}

/** Build the PVE web UI URL; mirrors `proxmox_web_ui_url` in the crate. */
export function buildProxmoxWebUiUrl(
  host: string,
  port = 8006,
  target?: ProxmoxWebUiTarget | null,
): string {
  const trimmed = host.trim();
  if (!trimmed) throw new Error("Proxmox host is empty");
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid Proxmox port: ${port}`);
  }
  const hostPart =
    trimmed.includes(":") && !trimmed.startsWith("[")
      ? `[${trimmed}]`
      : trimmed;
  let url = `https://${hostPart}:${port}/`;
  if (target) {
    const objectId = `${target.kind}/${target.id}`;
    // PVE hash: `#v1:0:=<type>/<id>` with the `/` percent-encoded.
    url += `#v1:0:=${encodeURIComponent(objectId)}`;
  }
  return url;
}

/** Build the ephemeral web-session connection. */
export function buildProxmoxWebUiConnection(
  input: BuildProxmoxWebUiConnectionInput,
): Connection {
  const host = input.host.trim();
  if (!host) throw new Error("Proxmox host is empty");
  const port = input.port ?? 8006;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid Proxmox port: ${port}`);
  }
  const username =
    input.authMode === "password"
      ? qualifyUsername(input.username, input.realm)
      : "";
  const password = input.password ?? "";
  const canAutoLogin =
    input.authMode === "password" && username.length > 0 && password.length > 0;
  const stamp = (input.now ?? (() => new Date().toISOString()))();
  const id =
    input.id ??
    `proxmox-webui-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;

  const connection: Connection = {
    id,
    name: input.name?.trim() || `Proxmox VE (${host})`,
    protocol: "https",
    hostname: host,
    port,
    isGroup: false,
    icon: "server",
    createdAt: stamp,
    updatedAt: stamp,
    httpAutoLogin: canAutoLogin,
  };
  if (canAutoLogin) {
    connection.username = username;
    connection.password = password;
    connection.httpAutoLoginSelectors = { ...PROXMOX_AUTO_LOGIN_SELECTORS };
  }
  if (input.insecure) {
    connection.httpVerifySsl = false;
  }
  return connection;
}

/** Register the ephemeral connection and announce it to the app shell.
 *  Returns the connection so callers/tests can inspect it. */
export function launchProxmoxWebUi(
  input: BuildProxmoxWebUiConnectionInput,
): Connection {
  const connection = buildProxmoxWebUiConnection(input);
  registerRuntimeConnection(connection);
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent<OpenRuntimeConnectionDetail>(PROXMOX_OPEN_WEB_UI_EVENT, {
        detail: { connection, source: "proxmox" },
      }),
    );
  }
  return connection;
}

/** Fallback: open the PVE web UI in the OS default browser (no auto-login). */
export function openProxmoxWebUiExternal(
  host: string,
  port = 8006,
  target?: ProxmoxWebUiTarget | null,
): Promise<void> {
  const url = buildProxmoxWebUiUrl(host, port, target);
  return invoke<void>("open_url_external", { url });
}
