import type {
  Connection,
  HttpAutoLoginSelectors,
} from "../../../types/connection/connection";
import { registerRuntimeConnection } from "../../../utils/session/runtimeConnectionRegistry";

export const PFSENSE_OPEN_WEB_UI_EVENT = "open-runtime-connection" as const;

export interface PfsenseOpenRuntimeConnectionDetail {
  connection: Connection;
  source: "pfsense";
}

/** Selectors from pfSense's WebGUI login form (`authgui.inc`). */
export const PFSENSE_AUTO_LOGIN_SELECTORS: Readonly<HttpAutoLoginSelectors> =
  Object.freeze({
    usernameSelector: "input#usernamefld",
    passwordSelector: "input#passwordfld",
    submitSelector: 'input[type="submit"][name="login"]',
  });

export interface BuildPfsenseWebUiConnectionInput {
  host: string;
  port: number;
  useTls: boolean;
  username?: string | null;
  password?: string | null;
  autoLogin: boolean;
  acceptInvalidCerts?: boolean;
  name?: string;
  id?: string;
  now?: () => string;
}

export function buildPfsenseWebUiConnection(
  input: BuildPfsenseWebUiConnectionInput,
): Connection {
  const hostname = input.host.trim();
  if (!hostname) throw new Error("pfSense web host is required");
  if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535) {
    throw new Error("pfSense web port must be between 1 and 65535");
  }

  const username = input.username?.trim() ?? "";
  const password = input.password ?? "";
  const canAutoLogin =
    input.autoLogin && username.length > 0 && password.length > 0;
  const stamp = (input.now ?? (() => new Date().toISOString()))();
  const id =
    input.id ??
    `pfsense-webui-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;

  const connection: Connection = {
    id,
    name: input.name?.trim() || `pfSense (${hostname})`,
    protocol: input.useTls ? "https" : "http",
    hostname,
    port: input.port,
    isGroup: false,
    icon: "pfsense",
    createdAt: stamp,
    updatedAt: stamp,
    httpAutoLogin: canAutoLogin,
  };
  if (canAutoLogin) {
    connection.username = username;
    connection.password = password;
    connection.httpAutoLoginSelectors = { ...PFSENSE_AUTO_LOGIN_SELECTORS };
  }
  if (input.useTls && input.acceptInvalidCerts) {
    connection.httpVerifySsl = false;
  }
  return connection;
}

export function launchPfsenseWebUi(
  input: BuildPfsenseWebUiConnectionInput,
): Connection {
  const connection = buildPfsenseWebUiConnection(input);
  registerRuntimeConnection(connection);
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent<PfsenseOpenRuntimeConnectionDetail>(
        PFSENSE_OPEN_WEB_UI_EVENT,
        { detail: { connection, source: "pfsense" } },
      ),
    );
  }
  return connection;
}
