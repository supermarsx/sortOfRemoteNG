import type { Server } from "node:http";

export type PhoneMode = "legacy" | "servlet";

export interface PhoneReboot {
  method: "action-uri" | "web-form";
  at: string;
}

export interface PhoneLoginAttempt {
  username: string;
  shape: "form-plain" | "form-rsa";
  ok: boolean;
}

export interface PhoneState {
  reboots: PhoneReboot[];
  sessions: Set<string>;
  loginAttempts: PhoneLoginAttempt[];
}

export interface PhoneServer extends Server {
  phoneState: PhoneState;
  phoneMode: PhoneMode;
  rsaModulusHex: string;
}

export interface PhoneServerOptions {
  mode?: PhoneMode;
  actionUri?: boolean;
  rsa?: boolean;
  username?: string;
  password?: string;
}

export const LOGIN_FORM_PATH: string;
export const LOGIN_POST_PATH: string;
export const STATUS_PATH: string;
export const REBOOT_FORM_PATH: string;
export const ACTION_URI_SERVLET: string;
export const LEGACY_APP_PATH: string;
export const ACTION_URI_LEGACY: string;
export const SESSION_COOKIE: string;
export const LEGACY_REALM: string;

export function createPhoneServer(options?: PhoneServerOptions): PhoneServer;
export function listen(
  server: Server,
  port: number,
  host: string,
): Promise<number>;
