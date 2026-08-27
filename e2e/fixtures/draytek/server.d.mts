import type { Server } from "node:http";

export type DraytekLoginScheme = "classic" | "token" | "rsa";

export interface DraytekWanRow {
  name: string;
  status: string;
  ip: string;
  gateway: string;
}

export interface DraytekReboot {
  at: string;
  method: "post" | "get";
  mode: string;
  tokenPresent: boolean;
}

export interface DraytekLoginAttempt {
  username: string;
  method: "post" | "get";
  tokenPresent: boolean;
  tokenAccepted: boolean;
  ok: boolean;
}

export interface DraytekState {
  reboots: DraytekReboot[];
  loginAttempts: DraytekLoginAttempt[];
  sessions: Set<string>;
  tokens: Set<string>;
}

export interface DraytekDevice {
  model: string;
  firmware: string;
  build: string;
  routerName: string;
  uptime: string;
  wan: DraytekWanRow[];
}

export interface DraytekServer extends Server {
  routerState: DraytekState;
  routerScheme: DraytekLoginScheme;
  routerDevice: DraytekDevice;
}

export interface DraytekServerOptions {
  scheme?: DraytekLoginScheme;
  username?: string;
  password?: string;
  model?: string;
  firmware?: string;
  build?: string;
  routerName?: string;
  uptime?: string;
  wan?: DraytekWanRow[];
}

export const LOGIN_PAGE_PATH: string;
export const LOGIN_CGI_PATH: string;
export const LOGOUT_CGI_PATH: string;
export const REBOOT_CGI_PATH: string;
export const STATUS_PAGE_PATHS: string[];
export const SESSION_COOKIE: string;
export const TOKEN_FIELD: string;
export const DEFAULT_MODEL: string;
export const DEFAULT_FIRMWARE: string;
export const DEFAULT_BUILD: string;
export const DEFAULT_ROUTER_NAME: string;
export const DEFAULT_UPTIME: string;
export const DEFAULT_WAN: DraytekWanRow[];

export function decodeCredential(value: string | null | undefined): string;
export function encodeCredential(value: string): string;
export function createDraytekServer(
  options?: DraytekServerOptions,
): DraytekServer;
export function listen(
  server: Server,
  port: number,
  host: string,
): Promise<number>;
