import type { Connection } from "../../types/connection/connection";
import {
  normalizeVoipPhoneSettings,
  VOIP_PHONE_DEFAULT_PORT,
  type VoipAccountStatus,
  type VoipPhoneConnectionConfig,
  type VoipPhoneSessionSummary,
  type VoipPhoneStatus,
  type VoipPhoneWebLoginHint,
  type VoipRebootResult,
} from "../../types/voipPhone";
import { invokeManagement } from "../security/managementInvoke";
import { generateId } from "../core/id";

/**
 * Wire shape of the Rust `WebLoginHint` (flat, camelCase). Converted to the
 * nested {@link VoipPhoneWebLoginHint} at this boundary so the panel only
 * ever sees the editor-facing type.
 */
interface VoipPhoneWebLoginHintWire {
  formLogin: boolean;
  loginUrl?: string;
  usernameSelector?: string | null;
  passwordSelector?: string | null;
  submitSelector?: string | null;
  note?: string | null;
}

export interface VoipPhoneResolvedWebLoginHint extends VoipPhoneWebLoginHint {
  loginUrl?: string;
  note?: string;
}

export interface VoipPhoneRuntimeAdapter {
  protocol: "voip-phone";
  displayName: string;
  buildConfig(connection: Connection): VoipPhoneConnectionConfig;
  connect(
    sessionId: string,
    connection: Connection,
  ): Promise<VoipPhoneSessionSummary>;
  disconnect(sessionId: string): Promise<void>;
  loadStatus(sessionId: string): Promise<VoipPhoneStatus>;
  reboot(sessionId: string): Promise<VoipRebootResult>;
  webLoginHint(sessionId: string): Promise<VoipPhoneResolvedWebLoginHint>;
}

const MAX_TEXT_LENGTH = 512;
const MAX_ACCOUNTS = 64;
const MAX_RAW_FIELDS = 256;

function optionalText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed.length > MAX_TEXT_LENGTH
    ? `${trimmed.slice(0, MAX_TEXT_LENGTH)}…`
    : trimmed;
}

function normalizeAccount(value: unknown, position: number): VoipAccountStatus {
  const raw = (value ?? {}) as Record<string, unknown>;
  const index =
    typeof raw.index === "number" && Number.isFinite(raw.index)
      ? raw.index
      : position + 1;
  return {
    index,
    label: optionalText(raw.label),
    user: optionalText(raw.user),
    server: optionalText(raw.server),
    registered: raw.registered === true,
    rawState: optionalText(raw.rawState),
  };
}

/** Bound and normalise a status payload coming back from the crate. */
export function normalizeVoipPhoneStatus(value: unknown): VoipPhoneStatus {
  if (!value || typeof value !== "object") {
    throw new Error("The phone returned an invalid status payload.");
  }
  const raw = value as Record<string, unknown>;
  const accountsRaw = Array.isArray(raw.accounts) ? raw.accounts : [];
  if (accountsRaw.length > MAX_ACCOUNTS) {
    throw new Error("The phone status exceeded the account limit.");
  }
  const rawFields: Record<string, string> = {};
  if (raw.rawFields && typeof raw.rawFields === "object") {
    const entries = Object.entries(raw.rawFields as Record<string, unknown>);
    if (entries.length > MAX_RAW_FIELDS) {
      throw new Error("The phone status exceeded the field limit.");
    }
    for (const [key, fieldValue] of entries) {
      const text = optionalText(fieldValue);
      if (text !== undefined) rawFields[optionalText(key) ?? key] = text;
    }
  }
  return {
    vendor: "yealink",
    model: optionalText(raw.model),
    firmware: optionalText(raw.firmware),
    hardware: optionalText(raw.hardware),
    mac: optionalText(raw.mac),
    ip: optionalText(raw.ip),
    uptime: optionalText(raw.uptime),
    generation: raw.generation === "servlet" ? "servlet" : "legacy",
    authShape:
      raw.authShape === "form-plain" || raw.authShape === "form-rsa"
        ? raw.authShape
        : "basic",
    accounts: accountsRaw.map(normalizeAccount),
    rawFields,
  };
}

export function normalizeWebLoginHint(
  value: unknown,
): VoipPhoneResolvedWebLoginHint {
  const raw = (value ?? {}) as VoipPhoneWebLoginHintWire;
  const usernameSelector = optionalText(raw.usernameSelector);
  const passwordSelector = optionalText(raw.passwordSelector);
  const submitSelector = optionalText(raw.submitSelector);
  const hasSelectors = Boolean(
    usernameSelector || passwordSelector || submitSelector,
  );
  return {
    formLogin: raw.formLogin === true,
    loginUrl: optionalText(raw.loginUrl),
    note: optionalText(raw.note),
    selectors: hasSelectors
      ? { usernameSelector, passwordSelector, submitSelector }
      : undefined,
  };
}

export function buildVoipPhoneConfig(
  connection: Connection,
): VoipPhoneConnectionConfig {
  const settings = normalizeVoipPhoneSettings(connection.voipPhoneSettings);
  return {
    host: connection.hostname,
    port: connection.port ?? VOIP_PHONE_DEFAULT_PORT,
    useSsl: settings.useSsl,
    verifyCert: settings.verifyCert,
    vendor: settings.vendor,
    username: connection.username ?? "",
    password: connection.password ?? "",
    timeoutSecs: settings.timeoutSecs,
    authMode: settings.authMode,
    actionUriEnabled: settings.actionUriEnabled,
  };
}

/**
 * Build the volatile `http`/`https` connection used by "Open Web UI".
 *
 * The result is meant for `registerRuntimeConnection` only — it carries the
 * phone's credentials so the proxy can inject Basic auth (legacy firmware) or
 * drive the login form (servlet firmware) — and must never be persisted or
 * copied onto a `ConnectionSession`.
 */
export function buildVoipPhoneWebUiConnection(
  connection: Connection,
  hint: VoipPhoneResolvedWebLoginHint,
): Connection {
  const settings = normalizeVoipPhoneSettings(connection.voipPhoneSettings);
  const now = new Date().toISOString();
  const username = connection.username ?? "";
  const password = connection.password ?? "";
  const webConnection: Connection = {
    id: generateId(),
    name: `${connection.name} — Web UI`,
    protocol: settings.useSsl ? "https" : "http",
    hostname: connection.hostname,
    port: connection.port ?? VOIP_PHONE_DEFAULT_PORT,
    isGroup: false,
    parentId: connection.parentId,
    createdAt: now,
    updatedAt: now,
    username,
    password,
    httpVerifySsl: settings.verifyCert,
    httpAutoLogin: hint.formLogin,
    httpAutoLoginSelectors: hint.formLogin ? hint.selectors : undefined,
  };
  if (!hint.formLogin) {
    // Legacy firmware protects the UI with HTTP Basic: the proxy injects the
    // Authorization header from the basic-auth pair.
    webConnection.authType = "basic";
    webConnection.basicAuthUsername = username;
    webConnection.basicAuthPassword = password;
  }
  return webConnection;
}

export const voipPhoneRuntimeAdapter: VoipPhoneRuntimeAdapter = {
  protocol: "voip-phone",
  displayName: "VoIP Phone",
  buildConfig: buildVoipPhoneConfig,
  async connect(sessionId, connection) {
    return invokeManagement<VoipPhoneSessionSummary>("voip_phone_connect", {
      id: sessionId,
      config: buildVoipPhoneConfig(connection),
    });
  },
  async disconnect(sessionId) {
    await invokeManagement<void>("voip_phone_disconnect", { id: sessionId });
  },
  async loadStatus(sessionId) {
    return normalizeVoipPhoneStatus(
      await invokeManagement<unknown>("voip_phone_get_status", {
        id: sessionId,
      }),
    );
  },
  async reboot(sessionId) {
    const result = await invokeManagement<VoipRebootResult>(
      "voip_phone_reboot",
      { id: sessionId },
    );
    return {
      method: result?.method === "web-form" ? "web-form" : "action-uri",
      accepted: result?.accepted === true,
    };
  },
  async webLoginHint(sessionId) {
    return normalizeWebLoginHint(
      await invokeManagement<unknown>("voip_phone_web_login_hint", {
        id: sessionId,
      }),
    );
  },
};
