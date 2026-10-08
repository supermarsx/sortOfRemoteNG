import * as ipaddr from "ipaddr.js";
import type { Connection } from "../../types/connection/connection";
import { generateId } from "../core/id";
import { getDefaultPort } from "../discovery/defaultPorts";

export interface QuickConnectConnectionInput {
  /** The picker supplies a host or host:port, with URL schemes removed. */
  hostname: string;
  protocol: string;
  username?: string;
  password?: string;
  domain?: string;
  authType?: "password" | "key";
  privateKey?: string;
  passphrase?: string;
  basicAuthUsername?: string;
  basicAuthPassword?: string;
  httpVerifySsl?: boolean;
}

function parsePort(value: string): number {
  const port = Number(value);
  if (
    !/^\d+$/.test(value) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    throw new Error("Quick Connect port must be an integer from 1 to 65535.");
  }
  return port;
}

function parseEndpoint(
  address: string,
  defaultPort: number,
): Pick<Connection, "hostname" | "port"> {
  // Never allow user-info into session names, history, logs, or host fields.
  const hasControlCharacter = Array.from(address).some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
  if (!address || hasControlCharacter || /[\s/\\@?#]/.test(address)) {
    throw new Error(
      "Quick Connect requires a hostname or IP address, optionally with a port.",
    );
  }

  if (address.startsWith("[")) {
    const match = /^\[([^\]]+)\](?::(.*))?$/.exec(address);
    if (!match || !ipaddr.IPv6.isValid(match[1])) {
      throw new Error("Quick Connect requires a valid bracketed IPv6 address.");
    }
    return {
      hostname: match[1],
      port: match[2] === undefined ? defaultPort : parsePort(match[2]),
    };
  }
  if (/[\[\]]/.test(address)) {
    throw new Error("Quick Connect IPv6 brackets are malformed.");
  }

  const colon = address.indexOf(":");
  if (colon !== address.lastIndexOf(":")) {
    // A bare IPv6 literal never carries a port. Require [IPv6]:port to
    // disambiguate; do not silently reinterpret its final hextet as a port.
    if (!ipaddr.IPv6.isValid(address)) {
      throw new Error(
        "Quick Connect requires a valid IPv6 address; use [IPv6]:port for an explicit port.",
      );
    }
    return { hostname: address, port: defaultPort };
  }
  if (colon === 0) {
    throw new Error("Quick Connect hostname is required.");
  }
  return colon < 0
    ? { hostname: address, port: defaultPort }
    : {
        hostname: address.slice(0, colon),
        port: parsePort(address.slice(colon + 1)),
      };
}

/**
 * Build a Quick Connect definition without registering or persisting it.
 * The caller registers it in runtimeConnectionRegistry before handleConnect;
 * credentials must never be copied to ConnectionSession or saved connections.
 */
export function createQuickConnectConnection(
  payload: QuickConnectConnectionInput,
  quickConnectLabel: string,
): Connection {
  const { protocol } = payload;
  if (
    protocol !== "ssh" &&
    protocol !== "rdp" &&
    protocol !== "vnc" &&
    protocol !== "telnet" &&
    protocol !== "http" &&
    protocol !== "https"
  ) {
    throw new Error(
      "This Quick Connect builder only supports SSH, RDP, VNC, Telnet, HTTP, and HTTPS.",
    );
  }
  const address = payload.hostname.trim();
  const endpoint = parseEndpoint(address, getDefaultPort(protocol));
  const timestamp = new Date().toISOString();
  const connection: Connection = {
    id: generateId(),
    name: `${quickConnectLabel} - ${address}`,
    protocol,
    ...endpoint,
    isGroup: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  // Explicit field lists keep unrelated credential/configuration fields out
  // of the runtime definition, even if a caller supplies a wider payload.
  if (protocol === "ssh") {
    connection.username = payload.username;
    connection.authType = payload.authType;
    connection.password = payload.password;
    connection.privateKey = payload.privateKey;
    connection.passphrase = payload.passphrase;
  } else if (protocol === "rdp") {
    connection.username = payload.username;
    connection.password = payload.password;
    connection.domain = payload.domain;
  } else if (protocol === "vnc") {
    connection.password = payload.password;
  } else if (protocol === "http" || protocol === "https") {
    if (payload.basicAuthUsername || payload.basicAuthPassword) {
      connection.authType = "basic";
      connection.basicAuthUsername = payload.basicAuthUsername;
      connection.basicAuthPassword = payload.basicAuthPassword;
    }
    if (protocol === "https") {
      connection.httpVerifySsl = payload.httpVerifySsl ?? true;
    }
  } else {
    connection.username = payload.username;
    connection.password = payload.password;
  }
  return connection;
}
