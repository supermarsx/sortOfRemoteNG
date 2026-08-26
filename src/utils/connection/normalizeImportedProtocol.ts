/**
 * Evidence-based protocol normaliser for imported / detected connections (t71 D1).
 *
 * Every importer, network-discovery path and paste handler used to fall back to
 * `"rdp"` whenever it did not recognise a protocol string. This module replaces
 * those scattered `|| "rdp"` sites with one deterministic resolver that weighs
 * three kinds of evidence in a fixed order:
 *
 *   1. the raw protocol string (alias table, case/whitespace-insensitive),
 *   2. a URL scheme found in the URL / hostname field,
 *   3. the port number.
 *
 * With no evidence at all it returns `raw` (the app's generic TCP protocol),
 * never RDP. RDP is only produced by an explicit alias (`rdp`, `ica`, `rdcman`),
 * an `rdp://` scheme, or port 3389.
 *
 * Pure module: no React, no Tauri, no side effects.
 */
import type {
  BuiltInConnectionProtocol,
  Connection,
  ConnectionProtocol,
} from "../../types/connection/connection";
import { isIntegrationConnectionProtocol } from "../../types/connection/connection";
import { DEFAULT_PORTS } from "../discovery/defaultPorts";
import { sanitizeHostname, schemeToProtocol } from "./sanitizeHostname";

export interface ProtocolEvidence {
  /** The protocol string as found in the source (any type; coerced). */
  raw?: unknown;
  /** Port as found in the source. Strings are parsed; invalid values ignored. */
  port?: number | string | null;
  /** A URL or hostname field that may carry a `scheme://` prefix. */
  url?: string | null;
}

export type ProtocolSource = "alias" | "url" | "port" | "fallback";

export interface NormalizedProtocol {
  /** Always a `BuiltInConnectionProtocol` or an `integration:*` passthrough. */
  protocol: ConnectionProtocol;
  source: ProtocolSource;
  /** True when `raw` was non-empty and we did not take it verbatim (case-only
   *  normalisation of an already-valid protocol is NOT a reclassification). */
  reclassified: boolean;
  /** Human-readable reason, e.g. `"Web" mapped to https (port 443)`. */
  note?: string;
  /** `DEFAULT_PORTS[protocol]`; never 3389 unless `protocol === "rdp"`. */
  defaultPort: number;
}

/** Protocol chosen when there is no evidence whatsoever. */
export const FALLBACK_PROTOCOL: BuiltInConnectionProtocol = "raw";

const BUILT_IN_PROTOCOLS: ReadonlySet<string> =
  new Set<BuiltInConnectionProtocol>([
    "rdp",
    "ssh",
    "ard",
    "serial",
    "vnc",
    "anydesk",
    "http",
    "https",
    "telnet",
    "raw",
    "rlogin",
    "mysql",
    "postgresql",
    "spice",
    "xdmcp",
    "x2go",
    "nx",
    "ftp",
    "sftp",
    "scp",
    "winrm",
    "rustdesk",
    "smb",
    "gcp",
    "azure",
    "ibm-csp",
    "digital-ocean",
    "heroku",
    "scaleway",
    "linode",
    "ovhcloud",
    "idrac",
    "ilo",
    "lenovo",
    "supermicro",
    "voip-phone",
  ]);

/** Sentinel alias value: "some web protocol — decide http vs https by port". */
const WEB_ALIAS = "web" as const;

/**
 * Well-known web ports. Used by the alias step (to pick http vs https for
 * generic "web" strings), the port step, and the suspicion helper.
 */
export const WEB_PORTS: Readonly<Record<number, "http" | "https">> =
  Object.freeze({
    80: "http",
    81: "http",
    8000: "http",
    8008: "http",
    8080: "http",
    8081: "http",
    8888: "http",
    9000: "http",
    10000: "http",
    443: "https",
    4443: "https",
    8006: "https",
    8043: "https",
    8443: "https",
    8834: "https",
    9090: "https",
    9443: "https",
    10443: "https",
  });

/**
 * Alias table: normalised raw string → protocol. Values of `"web"` mean
 * "http or https depending on port" and are resolved inside
 * {@link normalizeImportedProtocol}. Every valid `BuiltInConnectionProtocol`
 * is also accepted verbatim (not listed here to avoid drift).
 */
const RAW_ALIASES: Readonly<
  Record<string, ConnectionProtocol | typeof WEB_ALIAS>
> = Object.freeze({
  // Web
  http: "http",
  "http-basic": "http",
  winbox: "http",
  ws: "http",
  https: "https",
  "https-web": "https",
  ssl: "https",
  tls: "https",
  wss: "https",
  royalwebconnection: WEB_ALIAS,
  web: WEB_ALIAS,
  www: WEB_ALIAS,
  "web-browser": WEB_ALIAS,
  browser: WEB_ALIAS,
  url: WEB_ALIAS,
  website: WEB_ALIAS,
  webui: WEB_ALIAS,
  "web-ui": WEB_ALIAS,
  "http/s": WEB_ALIAS,
  "https/http": WEB_ALIAS,
  "http/https": WEB_ALIAS,
  intapp: WEB_ALIAS,
  "int-app": WEB_ALIAS,
  // Remote desktop
  rdp: "rdp",
  ica: "rdp",
  rdcman: "rdp",
  "remote-desktop": "rdp",
  mstsc: "rdp",
  vnc: "vnc",
  ard: "ard",
  "apple-remote-desktop": "ard",
  spice: "spice",
  xdmcp: "xdmcp",
  x2go: "x2go",
  nx: "nx",
  nomachine: "nx",
  rustdesk: "rustdesk",
  anydesk: "anydesk",
  // Shell
  ssh: "ssh",
  ssh1: "ssh",
  ssh2: "ssh",
  mosh: "ssh",
  wsl: "ssh",
  telnet: "telnet",
  rlogin: "rlogin",
  "r-login": "rlogin",
  serial: "serial",
  com: "serial",
  // Raw sockets
  raw: "raw",
  "raw-tcp": "raw",
  raw_tcp: "raw",
  "raw/tcp": "raw",
  rawsocket: "raw",
  "raw-udp": "raw",
  raw_udp: "raw",
  "raw/udp": "raw",
  udp: "raw",
  tcp: "raw",
  // File transfer
  sftp: "sftp",
  scp: "scp",
  ftp: "ftp",
  ftps: "ftp",
  // Windows remoting
  winrm: "winrm",
  powershell: "winrm",
  "powershell-remoting": "winrm",
  psremoting: "winrm",
  wsman: "winrm",
  // File shares / databases
  smb: "smb",
  cifs: "smb",
  mysql: "mysql",
  mariadb: "mysql",
  postgres: "postgresql",
  postgresql: "postgresql",
  pgsql: "postgresql",
});

/**
 * Public, read-only view of the alias table with the generic-web sentinel
 * resolved to `https` (the port-aware variant lives in
 * {@link normalizeImportedProtocol}).
 */
export const PROTOCOL_ALIASES: Readonly<Record<string, ConnectionProtocol>> =
  Object.freeze(
    Object.fromEntries(
      Object.entries(RAW_ALIASES).map(([alias, protocol]) => [
        alias,
        protocol === WEB_ALIAS ? "https" : protocol,
      ]),
    ) as Record<string, ConnectionProtocol>,
  );

/** Unambiguous port → protocol map (WEB_PORTS + reverse of DEFAULT_PORTS). */
const PORT_PROTOCOLS: Readonly<Record<number, BuiltInConnectionProtocol>> =
  Object.freeze({
    ...WEB_PORTS,
    22: "ssh",
    23: "telnet",
    3389: "rdp",
    5900: "vnc",
    5901: "vnc",
    5902: "vnc",
    5903: "vnc",
    5904: "vnc",
    5905: "vnc",
    5906: "vnc",
    5985: "winrm",
    5986: "winrm",
    445: "smb",
    3306: "mysql",
    5432: "postgresql",
    21: "ftp",
    513: "rlogin",
    177: "xdmcp",
  });

const normalizeRaw = (raw: unknown): string =>
  String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");

const parsePort = (port: ProtocolEvidence["port"]): number | undefined => {
  if (port === null || port === undefined || port === "") return undefined;
  const n = typeof port === "number" ? port : Number(String(port).trim());
  return Number.isInteger(n) && n > 0 && n <= 65535 ? n : undefined;
};

const isValidProtocol = (value: string): value is ConnectionProtocol =>
  BUILT_IN_PROTOCOLS.has(value) || isIntegrationConnectionProtocol(value);

const resolveWebAlias = (port: number | undefined): "http" | "https" =>
  port !== undefined && WEB_PORTS[port] === "http" ? "http" : "https";

/** Protocol implied by the port number alone, if unambiguous. */
export function protocolFromPort(
  port: number | string | null | undefined,
): BuiltInConnectionProtocol | undefined {
  const p = parsePort(port);
  return p === undefined ? undefined : PORT_PROTOCOLS[p];
}

/**
 * Protocol implied by the `scheme://` prefix of a URL / hostname value, if any.
 * Uses {@link sanitizeHostname} so it recognises exactly the schemes the editor
 * strips.
 */
export function protocolFromUrlScheme(
  url: string | null | undefined,
): ConnectionProtocol | undefined {
  if (!url) return undefined;
  const { scheme } = sanitizeHostname(url);
  return scheme ? schemeToProtocol(scheme) : undefined;
}

const defaultPortFor = (protocol: ConnectionProtocol): number =>
  DEFAULT_PORTS[protocol] ?? DEFAULT_PORTS[FALLBACK_PROTOCOL];

const finish = (
  protocol: ConnectionProtocol,
  source: ProtocolSource,
  reclassified: boolean,
  note?: string,
): NormalizedProtocol => ({
  protocol,
  source,
  reclassified,
  ...(note ? { note } : {}),
  defaultPort: defaultPortFor(protocol),
});

/**
 * Resolve a protocol from the available evidence. First hit wins:
 * alias → URL scheme → port → {@link FALLBACK_PROTOCOL}.
 */
export function normalizeImportedProtocol(
  evidence: ProtocolEvidence,
): NormalizedProtocol {
  const rawText = String(evidence.raw ?? "").trim();
  const normalized = normalizeRaw(evidence.raw);
  const port = parsePort(evidence.port);
  const portLabel = port !== undefined ? ` (port ${port})` : "";

  // 1. Alias table / verbatim valid protocol.
  if (normalized) {
    if (isValidProtocol(normalized)) {
      return finish(normalized, "alias", false);
    }
    const alias = RAW_ALIASES[normalized];
    if (alias) {
      const protocol = alias === WEB_ALIAS ? resolveWebAlias(port) : alias;
      return finish(
        protocol,
        "alias",
        true,
        `"${rawText}" mapped to ${protocol}${alias === WEB_ALIAS ? portLabel : ""}`,
      );
    }
  }

  // 2. URL scheme — from the url field, or from raw if it looks like a URL.
  const urlCandidates = [
    evidence.url,
    rawText.includes("://") ? rawText : undefined,
  ];
  for (const candidate of urlCandidates) {
    const fromScheme = protocolFromUrlScheme(candidate);
    if (fromScheme) {
      const scheme = sanitizeHostname(candidate!).scheme;
      return finish(
        fromScheme,
        "url",
        rawText.length > 0,
        `${rawText ? `"${rawText}" ` : ""}resolved to ${fromScheme} from ${scheme}:// address`,
      );
    }
  }

  // 3. Port table.
  const fromPort = protocolFromPort(port);
  if (fromPort) {
    return finish(
      fromPort,
      "port",
      rawText.length > 0,
      `${rawText ? `"${rawText}" ` : "No protocol given; "}resolved to ${fromPort} from port ${port}`,
    );
  }

  // 4. Fallback — never RDP without evidence.
  return finish(
    FALLBACK_PROTOCOL,
    "fallback",
    rawText.length > 0,
    rawText
      ? `Unknown protocol "${rawText}"; using ${FALLBACK_PROTOCOL} (generic TCP)${portLabel}`
      : `No protocol evidence; using ${FALLBACK_PROTOCOL} (generic TCP)${portLabel}`,
  );
}

const WEB_URL_HOST_RE = /^\s*(https?|wss?):\/\//i;
const WEB_NAME_RE = /\b(https?|web ?ui|portal|dashboard)\b/i;

export interface MisclassificationSuggestion {
  suggested: ConnectionProtocol;
  reason: string;
}

/**
 * Detect saved connections that are typed RDP but look like web servers, or
 * whose `protocol` value is not a recognised protocol at all. Returns `null`
 * when nothing is suspicious. Groups are never flagged. The ignore-list is
 * the caller's concern.
 */
export function suspectMisclassifiedConnection(
  connection: Pick<Connection, "protocol" | "hostname" | "port" | "name"> &
    Partial<Pick<Connection, "isGroup" | "description">>,
): MisclassificationSuggestion | null {
  if (connection.isGroup) return null;
  const protocol = String(connection.protocol ?? "");
  const hostname = String(connection.hostname ?? "");
  const port = parsePort(connection.port);

  if (!isValidProtocol(protocol)) {
    const resolved = normalizeImportedProtocol({
      raw: protocol,
      port,
      url: hostname,
    });
    return {
      suggested: resolved.protocol,
      reason: `Protocol "${protocol}" is not a recognised protocol; ${resolved.note ?? `suggest ${resolved.protocol}`}`,
    };
  }

  if (protocol !== "rdp") return null;

  const schemeMatch = hostname.match(WEB_URL_HOST_RE);
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase();
    const suggested: "http" | "https" =
      scheme === "http" || scheme === "ws" ? "http" : "https";
    return {
      suggested,
      reason: `Hostname starts with ${scheme}:// but the connection is typed RDP`,
    };
  }

  if (port !== undefined && WEB_PORTS[port]) {
    return {
      suggested: WEB_PORTS[port],
      reason: `Port ${port} is a web port but the connection is typed RDP`,
    };
  }

  if (port !== 3389) {
    const text = `${connection.name ?? ""} ${connection.description ?? ""}`;
    const nameMatch = text.match(WEB_NAME_RE);
    if (nameMatch) {
      const suggested: "http" | "https" =
        nameMatch[1].toLowerCase() === "http" ? "http" : "https";
      return {
        suggested,
        reason: `Name/description mentions "${nameMatch[1]}" and port ${port ?? "is unset"} is not 3389`,
      };
    }
  }

  return null;
}
