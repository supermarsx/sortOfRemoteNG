import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { KeyObject } from "node:crypto";

export type PhoneMode = "legacy" | "servlet";
export type PhoneAuthShape = "plain" | "rsa" | "rsa-aes";
export type PhoneLayout = "form" | "formless";
export type PhoneAuthStatus = "done" | "none" | "lock";

export interface PhoneReboot {
  method: "action-uri" | "web-form";
  at: string;
}

/** What the fixture decoded out of one attested RSA+AES login body. */
export interface PhoneLoginDetail {
  fields: string[];
  pwdBytes: number;
  wrappedBytes: number;
  keyLooksHex: boolean;
  ivLooksHex: boolean;
  session: "matched" | "unknown" | "missing";
  cookieSeen: boolean;
  randomPrefix: boolean;
  problems: string[];
}

export interface PhoneLoginAttempt {
  username: string;
  shape: "form-plain" | "form-rsa" | "form-rsa-aes";
  ok: boolean;
  authstatus?: PhoneAuthStatus | null;
  detail?: PhoneLoginDetail;
}

export interface PhoneState {
  reboots: PhoneReboot[];
  sessions: Set<string>;
  pending: Set<string>;
  loginAttempts: PhoneLoginAttempt[];
  failures: number;
  locked: boolean;
}

export interface PhoneServer extends Server {
  phoneState: PhoneState;
  phoneMode: PhoneMode;
  phoneAuthShape: PhoneAuthShape;
  rsaModulusHex: string;
  rsaExponentHex: string;
  phonePrivateKey: KeyObject | null;
}

export interface PhoneServerOptions {
  mode?: PhoneMode;
  actionUri?: boolean;
  rsa?: boolean;
  authShape?: PhoneAuthShape;
  layout?: PhoneLayout;
  lockAfter?: number;
  crossSiteCookie?: boolean;
  transformHtml?: (
    html: string,
    context: { kind: string; req: IncomingMessage; url: URL },
  ) => string;
  username?: string;
  password?: string;
}

export interface PhoneHandler {
  handle: (req: IncomingMessage, res: ServerResponse) => void;
  state: PhoneState;
  mode: PhoneMode;
  authShape: PhoneAuthShape;
  layout: PhoneLayout;
  rsaModulusHex: string;
  rsaExponentHex: string;
  privateKey: KeyObject | null;
}

export const LOGIN_FORM_PATH: string;
export const LOGIN_POST_PATH: string;
export const STATUS_PATH: string;
export const REBOOT_FORM_PATH: string;
export const ACTION_URI_SERVLET: string;
export const LEGACY_APP_PATH: string;
export const ACTION_URI_LEGACY: string;
export const PAGE_SCRIPT_PATH: string;
export const SESSION_COOKIE: string;
export const LEGACY_REALM: string;
export const PHONE_TYPE: string;
export const PHONE_FIRMWARE: string;
export const RSA_AES_LOGIN_FIELDS: readonly string[];

export function authStatusBody(status: PhoneAuthStatus): string;
export function decodeRsaAesLogin(
  fields: Record<string, string>,
  privateKey: KeyObject,
  modulusBytes: number,
): {
  problems: string[];
  keyHex?: string;
  ivHex?: string;
  random?: string;
  sessionId?: string;
  password?: string;
  pwdBytes?: number;
  wrappedBytes?: number;
};
export function createPhoneHandler(options?: PhoneServerOptions): PhoneHandler;
export function createPhoneServer(options?: PhoneServerOptions): PhoneServer;
export function listen(
  server: Server,
  port: number,
  host: string,
): Promise<number>;
