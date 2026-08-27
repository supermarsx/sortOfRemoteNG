import {
  Connection,
  type TunnelChainLayer,
  type TunnelType,
} from "../../types/connection/connection";
import { generateId } from "../../utils/core/id";
import {
  createDefaultRawSocketSettings,
  type RawSocketTransport,
} from "../../types/protocols/rawSocket";
import { DEFAULT_PORTS } from "../../utils/discovery/defaultPorts";
import {
  normalizeImportedProtocol,
  protocolFromUrlScheme,
} from "../../utils/connection/normalizeImportedProtocol";
import { sanitizeHostname } from "../../utils/connection/sanitizeHostname";
import {
  mapPortableProtocol,
  normalizeImportedAdvancedProtocolConnection,
  parseNativeAdvancedProtocolSettings,
} from "./advancedProtocolPortability";

const MAX_IMPORT_TEXT_CHARS = 33_554_432;
const MAX_IMPORT_CONNECTIONS = 20_000;
const MAX_IMPORT_NESTING_DEPTH = 64;
const MAX_IMPORT_JSON_NODES = 100_000;
const MAX_MREMOTENG_DECODED_BYTES = 25_165_824;
const MAX_MREMOTENG_PLAINTEXT_CODE_UNITS = Math.floor(
  MAX_MREMOTENG_DECODED_BYTES / 3,
);
const MAX_MREMOTENG_ENCODED_CHARS = 33_554_432;
const MAX_MREMOTENG_ENCRYPTED_FIELDS = 60_000;

const assertImportTextWithinLimit = (content: string): void => {
  if (content.length > MAX_IMPORT_TEXT_CHARS) {
    throw new Error(
      `Import payload exceeds the ${MAX_IMPORT_TEXT_CHARS}-character safety limit`,
    );
  }
};

const assertCanAppendConnection = (
  currentCount: number,
  additionalCount = 1,
): void => {
  if (
    !Number.isSafeInteger(currentCount) ||
    !Number.isSafeInteger(additionalCount) ||
    additionalCount < 0 ||
    currentCount > MAX_IMPORT_CONNECTIONS - additionalCount
  ) {
    throw new Error(
      `Import contains more than ${MAX_IMPORT_CONNECTIONS} connections`,
    );
  }
};

const getBoundedXmlElements = (
  root: ParentNode,
  selector: string,
): Element[] => {
  const nodeList = root.querySelectorAll(selector);
  if (nodeList.length > MAX_IMPORT_CONNECTIONS) {
    throw new Error(
      `Import contains more than ${MAX_IMPORT_CONNECTIONS} XML objects`,
    );
  }
  const nodes = Array.from(nodeList);
  for (const node of nodes) {
    let depth = 0;
    let parent = node.parentElement;
    while (parent) {
      depth += 1;
      if (depth > MAX_IMPORT_NESTING_DEPTH) {
        throw new Error("XML nesting exceeds the safety limit");
      }
      parent = parent.parentElement;
    }
  }
  return nodes;
};

const assertJsonStructureWithinLimits = (root: unknown): void => {
  const pending: Array<{ value: unknown; depth: number }> = [
    { value: root, depth: 0 },
  ];
  let visitedNodes = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) break;
    visitedNodes += 1;
    if (visitedNodes > MAX_IMPORT_JSON_NODES) {
      throw new Error("JSON structure exceeds the aggregate node safety limit");
    }
    if (current.depth > MAX_IMPORT_NESTING_DEPTH) {
      throw new Error("JSON nesting exceeds the safety limit");
    }
    if (!current.value || typeof current.value !== "object") continue;
    const children = Array.isArray(current.value)
      ? current.value
      : Object.values(current.value as Record<string, unknown>);
    if (children.length > MAX_IMPORT_JSON_NODES - pending.length) {
      throw new Error("JSON structure exceeds the aggregate node safety limit");
    }
    for (const child of children) {
      pending.push({ value: child, depth: current.depth + 1 });
    }
  }
};

export const parseCSVLine = (line: string): string[] => {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      values.push(current.trim().replace(/\r$/, ""));
      current = "";
    } else {
      current += char;
    }
  }

  values.push(current.trim().replace(/\r$/, ""));
  return values;
};

/** Default port for a (possibly vendor-spelled) protocol string — via the
 *  evidence-based normaliser, so an unknown string never yields 3389. */
const getDefaultPort = (protocol: string): number =>
  normalizeImportedProtocol({ raw: protocol }).defaultPort;

/** Parse a source port value; `undefined` when absent or not a positive int. */
const parseImportedPort = (portValue: unknown): number | undefined => {
  if (typeof portValue === "number") {
    return Number.isFinite(portValue) && portValue > 0
      ? Math.trunc(portValue)
      : undefined;
  }
  const normalizedPort = String(portValue ?? "").trim();
  if (!normalizedPort) return undefined;
  const parsedPort = Number.parseInt(normalizedPort, 10);
  return Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : undefined;
};

const parsePortOrDefault = (portValue: unknown, protocol: string): number =>
  parseImportedPort(portValue) ?? getDefaultPort(protocol);

const isWebProtocol = (protocol: unknown): protocol is "http" | "https" =>
  protocol === "http" || protocol === "https";

interface ResolvedImportedEndpoint {
  protocol: Connection["protocol"];
  hostname: string;
  port: number;
  rawTransport?: RawSocketTransport;
}

/**
 * Resolve protocol + hostname + port for an imported record from all the
 * evidence a source carries (t71 D2): the protocol string, the port, and a
 * `scheme://` prefix on the hostname/URL field. A scheme prefix is stripped
 * from the hostname (as the editor does) and its embedded port is used when
 * the source gave none. RDP is never chosen without evidence.
 *
 * When the protocol string and the URL scheme are *both* web protocols the
 * scheme wins (`Protocol="Web" Hostname="http://router/"` → http).
 */
const resolveImportedEndpoint = (
  rawProtocol: unknown,
  hostnameValue: unknown,
  portValue: unknown,
  urlValue?: unknown,
): ResolvedImportedEndpoint => {
  const hostnameText = String(hostnameValue ?? "").trim();
  const urlText = String(urlValue ?? "").trim() || hostnameText;
  const sanitized = sanitizeHostname(urlText);
  const sourcePort = parseImportedPort(portValue);
  const port = sourcePort ?? sanitized.port;

  const normalized = normalizeImportedProtocol({
    raw: rawProtocol,
    port,
    url: urlText,
  });
  let protocol = normalized.protocol;
  const fromScheme = protocolFromUrlScheme(urlText);
  if (
    fromScheme &&
    isWebProtocol(fromScheme) &&
    isWebProtocol(protocol) &&
    fromScheme !== protocol
  ) {
    protocol = fromScheme;
  }

  const hostname = hostnameText
    ? urlText === hostnameText && sanitized.stripped
      ? sanitized.hostname
      : hostnameText
    : sanitized.hostname;

  const rawTransport = mapPortableProtocol(rawProtocol).rawTransport;

  return {
    protocol,
    hostname,
    port: port ?? DEFAULT_PORTS[protocol] ?? normalized.defaultPort,
    ...(protocol === "raw" && rawTransport ? { rawTransport } : {}),
  };
};

const rawSocketSettingsFor = (endpoint: ResolvedImportedEndpoint) =>
  endpoint.rawTransport
    ? {
        rawSocketSettings: createDefaultRawSocketSettings(
          endpoint.rawTransport,
        ),
      }
    : {};

export const importFromCSV = async (content: string): Promise<Connection[]> => {
  assertImportTextWithinLimit(content);
  const lines = content.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length > MAX_IMPORT_CONNECTIONS + 1) {
    throw new Error("CSV row count exceeds the safety limit");
  }
  if (lines.length < 2)
    throw new Error("CSV file must have headers and at least one data row");

  const headers = lines[0].split(",").map((h) => h.trim().replace(/"/g, ""));
  const connections: Connection[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length !== headers.length) continue;

    const conn: Record<string, string> = {};
    headers.forEach((header, index) => {
      conn[header] = values[index];
    });

    connections.push(buildNativeRecordConnection(conn));
  }

  return connections.map(normalizeImportedAdvancedProtocolConnection);
};

const getRecordValue = (
  record: Record<string, unknown>,
  ...names: string[]
): string | undefined => {
  for (const name of names) {
    const direct = record[name];
    if (direct !== undefined && direct !== null && String(direct) !== "") {
      return String(direct);
    }
  }
  const lowered = new Map(
    Object.entries(record).map(([key, value]) => [key.toLowerCase(), value]),
  );
  for (const name of names) {
    const value = lowered.get(name.toLowerCase());
    if (value !== undefined && value !== null && String(value) !== "") {
      return String(value);
    }
  }
  return undefined;
};

/**
 * Build a connection from a native flat record (CSV row, INI section, XML
 * attribute bag) using the CSV header vocabulary. Protocol is resolved from
 * evidence (string + port + hostname scheme); groups without a protocol keep
 * an RDP placeholder because they are never opened.
 */
const buildNativeRecordConnection = (
  record: Record<string, string>,
): Connection => {
  // Strict lower-case "true", matching the CSV exporter (a stray "True" is
  // treated as a regular connection, as before).
  const isGroup = (getRecordValue(record, "IsGroup") ?? "").trim() === "true";
  const rawProtocol = getRecordValue(record, "Protocol", "Type");
  const endpoint = resolveImportedEndpoint(
    rawProtocol,
    getRecordValue(record, "Hostname", "Server", "Host"),
    getRecordValue(record, "Port"),
  );
  const protocol: Connection["protocol"] =
    isGroup && !rawProtocol ? "rdp" /* group placeholder */ : endpoint.protocol;

  return normalizeImportedAdvancedProtocolConnection({
    ...rawSocketSettingsFor(endpoint),
    id: getRecordValue(record, "ID", "Id") || generateId(),
    name: getRecordValue(record, "Name") || "Imported Connection",
    protocol,
    hostname: endpoint.hostname,
    port: isGroup && !rawProtocol ? 0 : endpoint.port,
    username: getRecordValue(record, "Username") || undefined,
    domain: getRecordValue(record, "Domain") || undefined,
    description: getRecordValue(record, "Description") || undefined,
    parentId: getRecordValue(record, "ParentId") || undefined,
    isGroup,
    tags:
      getRecordValue(record, "Tags")
        ?.split(/[;,]/)
        .map((t) => t.trim())
        .filter(Boolean) || [],
    createdAt: new Date(
      getRecordValue(record, "CreatedAt") || Date.now(),
    ).toISOString(),
    updatedAt: new Date(
      getRecordValue(record, "UpdatedAt") || Date.now(),
    ).toISOString(),
    ...parseNativeAdvancedProtocolSettings(record),
  });
};

/**
 * Parse the native INI import template: one `[Section]` per connection
 * (section title = name), `Key=Value` lines using the CSV header vocabulary.
 * Lines starting with `;` or `#` are comments.
 */
export const importFromINI = async (content: string): Promise<Connection[]> => {
  assertImportTextWithinLimit(content);
  const sections: Array<Record<string, string>> = [];
  let current: Record<string, string> | undefined;

  for (const line of content.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(";") || trimmed.startsWith("#"))
      continue;
    const section = trimmed.match(/^\[(.+)\]$/);
    if (section) {
      assertCanAppendConnection(sections.length);
      current = { Name: section[1].trim() };
      sections.push(current);
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq <= 0 || !current) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key.toLowerCase() === "name" && !value) continue;
    current[key] = value;
  }

  if (sections.length === 0) {
    throw new Error("INI file must contain at least one [Connection] section");
  }

  return sections.map(buildNativeRecordConnection);
};

const parseIsoOrNow = (value: string | null): string => {
  const parsed = new Date(value || Date.now());
  return Number.isNaN(parsed.getTime())
    ? new Date().toISOString()
    : parsed.toISOString();
};

/**
 * Parse native sortOfRemoteNG XML exports.
 */
export const importFromXML = async (content: string): Promise<Connection[]> => {
  assertImportTextWithinLimit(content);
  const parser = new DOMParser();
  const doc = parser.parseFromString(content, "text/xml");
  const parseError = doc.querySelector("parsererror");
  if (parseError) {
    throw new Error("Invalid XML format: " + parseError.textContent);
  }

  const root = doc.documentElement;
  if (!root || root.tagName !== "sortOfRemoteNG") {
    throw new Error(
      "Invalid sortOfRemoteNG XML: expected <sortOfRemoteNG> root",
    );
  }

  // Two shapes are accepted (t71 RC1):
  //  - exporter shape: flat `<Connection Id Name Type Server Port … ParentId IsGroup/>`
  //  - template shape: `<connections><connection name protocol hostname port …/>`
  //    with nested `<group name>` folders (the downloadable import template).
  // Tag and attribute names are matched case-insensitively.
  const nodes = getBoundedXmlElements(root, "Connection, connection");
  if (nodes.length === 0) {
    throw new Error("Invalid sortOfRemoteNG XML: no Connection nodes found");
  }

  const connections: Connection[] = [];
  const groupIds = new Map<Element, string>();

  const attributesOf = (node: Element): Record<string, string> =>
    Object.fromEntries(
      Array.from(node.attributes).map((attribute) => [
        attribute.name,
        attribute.value,
      ]),
    );

  const walk = (parent: Element, parentGroupId?: string): void => {
    for (const node of Array.from(parent.children)) {
      const tag = node.localName.toLowerCase();
      if (tag === "group" || tag === "folder") {
        assertCanAppendConnection(connections.length);
        const attributes = attributesOf(node);
        const groupId = getRecordValue(attributes, "Id") || generateId();
        groupIds.set(node, groupId);
        connections.push({
          id: groupId,
          name: getRecordValue(attributes, "Name") || "Imported Folder",
          protocol: "rdp", // group placeholder
          hostname: "",
          port: 0,
          isGroup: true,
          parentId: getRecordValue(attributes, "ParentId") || parentGroupId,
          description: getRecordValue(attributes, "Description") || undefined,
          tags: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        walk(node, groupId);
        continue;
      }
      if (tag === "connection") {
        assertCanAppendConnection(connections.length);
        const attributes = attributesOf(node);
        for (const key of Object.keys(attributes)) {
          if (key.toLowerCase() === "isgroup") {
            attributes[key] = attributes[key].trim().toLowerCase();
          }
        }
        const built = buildNativeRecordConnection(attributes);
        connections.push({
          ...built,
          parentId: built.parentId ?? parentGroupId,
          createdAt: parseIsoOrNow(
            getRecordValue(attributes, "CreatedAt") ?? null,
          ),
          updatedAt: parseIsoOrNow(
            getRecordValue(attributes, "UpdatedAt") ?? null,
          ),
        });
        walk(node, parentGroupId);
        continue;
      }
      // Wrapper elements (<connections>, <Connections>, …): descend.
      walk(node, parentGroupId);
    }
  };

  walk(root);
  return connections;
};

/**
 * Supported import formats
 */
export type ImportFormat =
  | "json" // Native sortOfRemoteNG JSON
  | "xml" // Native sortOfRemoteNG XML
  | "csv" // Native sortOfRemoteNG CSV
  | "ini" // Native sortOfRemoteNG INI template
  | "mremoteng" // mRemoteNG XML format
  | "rdcman" // Remote Desktop Connection Manager
  | "royalts" // Royal TS/TSX JSON format
  | "mobaxterm" // MobaXterm INI format
  | "putty" // PuTTY registry export
  | "securecrt" // SecureCRT XML sessions
  | "termius"; // Termius JSON export

export type ImportFormatGroup = "native" | "vendor";

export interface ImportFormatCompatibility {
  value: ImportFormat;
  label: string;
  group: ImportFormatGroup;
  extensions: string[];
  signatures: string[];
  dataClasses: string[];
  credentialSupport: "full" | "partial" | "none";
  description: string;
  warning?: string;
}

export const IMPORT_FORMAT_ORDER: ImportFormat[] = [
  "json",
  "xml",
  "csv",
  "ini",
  "mremoteng",
  "rdcman",
  "termius",
  "royalts",
  "mobaxterm",
  "putty",
  "securecrt",
];

export const IMPORT_FORMAT_COMPATIBILITY: Record<
  ImportFormat,
  ImportFormatCompatibility
> = {
  json: {
    value: "json",
    label: "JSON",
    group: "native",
    extensions: [".json", ".encrypted"],
    signatures: [
      '{ "connections": [...] }',
      '{ "databases": [...] }',
      "[{ ... }]",
    ],
    dataClasses: [
      "connections",
      "folders",
      "settings sidecars",
      "VPN",
      "tunnel chains",
    ],
    credentialSupport: "full",
    description: "Native sortOfRemoteNG JSON exports and connection arrays.",
  },
  xml: {
    value: "xml",
    label: "XML",
    group: "native",
    extensions: [".xml", ".encrypted"],
    signatures: ["<sortOfRemoteNG>", "<Connection ... />"],
    dataClasses: ["connections", "folders", "versioned protocol settings"],
    credentialSupport: "partial",
    description:
      "Native sortOfRemoteNG XML connection exports with versioned RAW, RLogin, and PowerShell Remoting settings.",
  },
  csv: {
    value: "csv",
    label: "CSV",
    group: "native",
    extensions: [".csv", ".encrypted"],
    signatures: ["Name,Protocol,Hostname,Port", "ID,Name,Protocol,Hostname"],
    dataClasses: ["connections", "folders", "versioned protocol settings"],
    credentialSupport: "partial",
    description:
      "Native sortOfRemoteNG CSV exports with scalar JSON fields for versioned protocol settings.",
  },
  ini: {
    value: "ini",
    label: "INI",
    group: "native",
    extensions: [".ini"],
    signatures: ["[Connection Name]", "Protocol=", "Hostname="],
    dataClasses: ["connections", "folders"],
    credentialSupport: "partial",
    description:
      "Native sortOfRemoteNG INI template: one [section] per connection with the CSV field names as keys.",
  },
  mremoteng: {
    value: "mremoteng",
    label: "mRemoteNG",
    group: "vendor",
    extensions: [".xml"],
    signatures: ["<Connections ConfVersion=...>", "<Node Protocol=...>"],
    dataClasses: ["connections", "folders", "SSH tunnels"],
    credentialSupport: "partial",
    description:
      "mRemoteNG connection XML, including supported encrypted AES-GCM files.",
    warning:
      "mRemoteNG cannot represent advanced RAW/TCP, RAW/UDP, RLogin, or PowerShell Remoting settings; only compatible endpoint fields are mapped.",
  },
  rdcman: {
    value: "rdcman",
    label: "RDCMan",
    group: "vendor",
    extensions: [".rdg", ".xml"],
    signatures: ["<RDCMan>", "<file><group>"],
    dataClasses: ["RDP connections", "groups"],
    credentialSupport: "partial",
    description: "Remote Desktop Connection Manager server groups.",
    warning: "RDCMan does not carry sortOfRemoteNG advanced protocol settings.",
  },
  termius: {
    value: "termius",
    label: "Termius",
    group: "vendor",
    extensions: [".json"],
    signatures: ['{ "hosts": [...] }'],
    dataClasses: ["SSH hosts", "groups"],
    credentialSupport: "partial",
    description: "Termius JSON host exports.",
    warning:
      "Termius exports do not carry sortOfRemoteNG advanced protocol settings.",
  },
  royalts: {
    value: "royalts",
    label: "Royal TS/TSX",
    group: "vendor",
    extensions: [".rtsz", ".rtsx", ".json"],
    signatures: ['{ "Objects": [...] }', "RoyalFolder"],
    dataClasses: ["connections", "folders"],
    credentialSupport: "partial",
    description: "Royal TS/TSX object exports.",
    warning:
      "Royal TS/TSX protocol mappings preserve compatible endpoints, not sortOfRemoteNG advanced settings.",
  },
  mobaxterm: {
    value: "mobaxterm",
    label: "MobaXterm",
    group: "vendor",
    extensions: [".ini"],
    signatures: ["[Bookmarks]", "SubRep="],
    dataClasses: ["sessions", "folders"],
    credentialSupport: "none",
    description: "MobaXterm bookmark INI files.",
    warning:
      "MobaXterm bookmarks do not carry sortOfRemoteNG advanced protocol settings.",
  },
  putty: {
    value: "putty",
    label: "PuTTY",
    group: "vendor",
    extensions: [".reg"],
    signatures: ["REGEDIT4", "SimonTatham\\PuTTY\\Sessions"],
    dataClasses: ["sessions"],
    credentialSupport: "none",
    description: "PuTTY registry session exports.",
    warning:
      "PuTTY RAW and RLogin endpoints are mapped, but application-specific advanced settings are unavailable.",
  },
  securecrt: {
    value: "securecrt",
    label: "SecureCRT",
    group: "vendor",
    extensions: [".xml"],
    signatures: ["<VanDyke>", 'S:"Protocol Name"'],
    dataClasses: ["sessions"],
    credentialSupport: "partial",
    description: "SecureCRT XML session exports.",
    warning:
      "SecureCRT protocol mappings preserve compatible endpoints, not sortOfRemoteNG advanced settings.",
  },
};

export const getImportFormatCompatibility = (
  format: ImportFormat,
): ImportFormatCompatibility => IMPORT_FORMAT_COMPATIBILITY[format];

const looksLikeMobaXterm = (content: string): boolean =>
  content.includes("[Bookmarks") || content.includes("SubRep=");

const looksLikeNativeIni = (content: string): boolean =>
  /^\s*\[[^\]\r\n]+\]\s*$/m.test(content) &&
  /^\s*(Protocol|Hostname)\s*=/im.test(content);

/**
 * Detect import format from file content
 */
export const detectImportFormat = (
  content: string,
  filename?: string,
): ImportFormat => {
  // Strip BOM and whitespace.
  const trimmed = content.replace(/^\uFEFF/, "").trim();
  let extIsXml = false;

  // Check filename extension first when an extension is unambiguous.
  if (filename) {
    const lower = filename.toLowerCase();
    const ext = lower.split(".").pop();
    if (ext === "csv") return "csv";
    if (ext === "rtsz" || ext === "rtsx" || lower.includes("royalts"))
      return "royalts";
    if (lower.includes("termius")) return "termius";
    if (ext === "rdg") return "rdcman";
    if (ext === "reg") return "putty";
    if (ext === "ini" && lower.includes("moba")) return "mobaxterm";
    if (ext === "ini" && !looksLikeMobaXterm(trimmed)) return "ini";
    if (ext === "xml") extIsXml = true;
  }

  // Native sortOfRemoteNG XML.
  if (trimmed.includes("<sortOfRemoteNG") || trimmed.includes("<Connection ")) {
    return "xml";
  }

  // mRemoteNG detection - the <Connections> root tag is distinctive.
  // ConfVersion is usually present but absent in some encrypted exports,
  // so we accept either marker.
  if (
    trimmed.includes("<Connections") &&
    (trimmed.includes("ConfVersion") ||
      trimmed.includes("FullFileEncryption") ||
      trimmed.includes("Protected="))
  ) {
    return "mremoteng";
  }

  // RDCMan detection
  if (
    trimmed.includes("<RDCMan") ||
    (trimmed.includes("<file") && trimmed.includes("<group"))
  ) {
    return "rdcman";
  }

  // Royal TS JSON format
  if (
    trimmed.startsWith("{") &&
    (trimmed.includes('"Objects"') || trimmed.includes('"RoyalFolder"'))
  ) {
    return "royalts";
  }

  // MobaXterm INI format
  if (looksLikeMobaXterm(trimmed)) {
    return "mobaxterm";
  }

  // PuTTY registry format
  if (
    trimmed.includes("REGEDIT") ||
    trimmed.includes("[HKEY_CURRENT_USER\\Software\\SimonTatham\\PuTTY")
  ) {
    return "putty";
  }

  // SecureCRT XML sessions
  if (trimmed.includes("<VanDyke") || trimmed.includes('S:"Protocol Name"')) {
    return "securecrt";
  }

  // Native INI template: [Section] headers plus Protocol=/Hostname= keys.
  if (looksLikeNativeIni(trimmed)) {
    return "ini";
  }

  // Termius JSON
  if (trimmed.startsWith("{") && trimmed.includes('"hosts"')) {
    return "termius";
  }

  // Generic XML check
  if (trimmed.startsWith("<?xml") || trimmed.startsWith("<")) {
    // Could be mRemoteNG without the standard header
    if (
      trimmed.includes("Node") &&
      (trimmed.includes("Protocol=") || trimmed.includes("Hostname="))
    ) {
      return "mremoteng";
    }
    // A bare <Connections>…</Connections> wrapper (e.g. fully-encrypted body
    // with no plaintext ConfVersion) is still mRemoteNG.
    if (trimmed.includes("<Connections")) {
      return "mremoteng";
    }
  }

  // Generic JSON check
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return "json";
  }

  // .xml filename without a matched signature: assume mRemoteNG rather than
  // falling through to CSV (which would otherwise eat encrypted XML blobs).
  if (extIsXml) return "mremoteng";

  // Default to CSV
  return "csv";
};

const getMRemoteNGAttribute = (
  node: Element,
  ...names: string[]
): string | undefined => {
  for (const name of names) {
    const value = node.getAttribute(name);
    if (value !== null) return value;
  }
  return undefined;
};

const parseMRemoteNGBool = (value: string | undefined): boolean | undefined => {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (["true", "yes", "1"].includes(normalized)) return true;
  if (["false", "no", "0"].includes(normalized)) return false;
  return undefined;
};

const resolveMRemoteNGSshTunnelName = (
  node: Element,
  inheritedTunnelName?: string,
): string | undefined => {
  const explicit = getMRemoteNGAttribute(
    node,
    "SSHTunnelConnectionName",
  )?.trim();
  if (explicit) return explicit;

  // mRemoteNG defaults every `Inherit*` flag to FALSE. Only inherit the
  // container's tunnel when the node explicitly opts in with
  // `InheritSSHTunnelConnectionName="true"`. When the attribute is absent
  // (undefined) we must NOT inherit (R6 — previously this fell through to
  // `inheritedTunnelName`, attaching tunnels to connections that should not
  // have them, especially in trimmed/older confCons files).
  const inherit = parseMRemoteNGBool(
    getMRemoteNGAttribute(node, "InheritSSHTunnelConnectionName"),
  );
  if (inherit === true) return inheritedTunnelName;
  return undefined;
};

/**
 * Container-inheritable connection properties for mRemoteNG nodes. mRemoteNG
 * lets a connection inherit Username/Password/Domain/Hostname/Port from its
 * parent container via `Inherit*` flags (default false). We thread the
 * container's resolved values down the tree so that jump-host nodes which
 * inherit their credentials still import with usable host/creds (R7).
 */
interface MRemoteNGInheritableProps {
  username?: string;
  password?: string;
  domain?: string;
  hostname?: string;
  port?: string;
  protocol?: string;
}

/**
 * Resolve a node's protocol string honouring `InheritProtocol` (t71 RC3).
 * Unlike the other inheritable props, the inherit flag wins over the direct
 * attribute: mRemoteNG keeps a stale default (`Protocol="RDP"`) on children
 * that inherit, so the direct value is not evidence when the flag is set.
 */
const resolveMRemoteNGProtocol = (
  node: Element,
  inheritedProtocol: string | undefined,
): string | undefined => {
  const inherit = parseMRemoteNGBool(
    getMRemoteNGAttribute(node, "InheritProtocol"),
  );
  if (inherit === true && inheritedProtocol) return inheritedProtocol;
  const direct = node.getAttribute("Protocol")?.trim();
  return direct || undefined;
};

/**
 * Resolve a single connection property, honouring the node's `Inherit<Prop>`
 * flag. A direct attribute always wins; otherwise the parent container's value
 * is used only when `Inherit<Prop>="true"`. Absent flag ⇒ no inheritance
 * (mRemoteNG default-false semantics).
 */
const resolveMRemoteNGInheritedProp = (
  node: Element,
  attrName: string,
  inheritFlagName: string,
  inheritedValue: string | undefined,
): string | undefined => {
  const direct = node.getAttribute(attrName);
  if (direct !== null && direct !== "") return direct;

  const inherit = parseMRemoteNGBool(
    getMRemoteNGAttribute(node, inheritFlagName),
  );
  if (
    inherit === true &&
    inheritedValue !== undefined &&
    inheritedValue !== ""
  ) {
    return inheritedValue;
  }
  // Preserve a present-but-empty direct attribute as empty (explicit clear).
  return direct !== null ? direct : undefined;
};

/**
 * Inspect an mRemoteNG XML payload for encryption metadata on the
 * `<Connections>` root element.
 *
 * - `fullFileEncryption`: the body of `<Connections>` is a single encrypted
 *   blob — children cannot be parsed without the password.
 * - `protected`: a non-empty `Protected` attribute means a password is
 *   recorded; per-attribute encryption is in use even without full-file
 *   encryption.
 */
export interface MRemoteNGEncryptionInfo {
  isEncrypted: boolean;
  fullFileEncryption: boolean;
  requiresPassword: boolean;
}

// mRemoteNG's hardcoded master password used when the user never sets one.
// See upstream `Runtime.EncryptionKey` / cryptography provider.
export const MREMOTENG_DEFAULT_MASTER_PASSWORD = "mR3m";

// Plaintext stored in the `Protected` attribute. Decrypts to one of these
// strings depending on whether a custom master password was set:
//   - "ThisIsNotProtected"  → no master password set; default `mR3m` works
//   - "ThisIsProtected"     → user set a custom master password
const PROTECTED_PLAINTEXT_NO_PASSWORD = "ThisIsNotProtected";
const PROTECTED_PLAINTEXT_PASSWORD = "ThisIsProtected";

// Wire format constants for AES-256-GCM (the only cipher implemented here).
// Layout per upstream `AeadCryptographyProvider.cs`:
//   [ salt (16) ] [ nonce (16) ] [ ciphertext ‖ tag (16) ]   then base64
// The salt is also used as AES-GCM additional authenticated data.
const MRNG_SALT_SIZE = 16;
const MRNG_NONCE_SIZE = 16;
const MRNG_TAG_SIZE = 16;

const asBufferSource = (bytes: Uint8Array): BufferSource =>
  bytes as Uint8Array<ArrayBuffer>;

interface MRemoteNGDecodeBudget {
  remainingDecodedBytes: number;
}

const createMRemoteNGDecodeBudget = (): MRemoteNGDecodeBudget => ({
  remainingDecodedBytes: MAX_MREMOTENG_DECODED_BYTES,
});

const decodeBase64 = (
  b64: string,
  budget: MRemoteNGDecodeBudget,
): Uint8Array => {
  if (b64.length > MAX_MREMOTENG_ENCODED_CHARS) {
    throw new Error("mRemoteNG base64 payload exceeds the encoded-size limit");
  }
  const clean = b64.replace(/\s+/g, "");
  if (
    clean.length === 0 ||
    clean.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      clean,
    )
  ) {
    throw new Error("mRemoteNG ciphertext is not canonical base64");
  }
  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  const decodedLength = (clean.length / 4) * 3 - padding;
  if (
    decodedLength > MAX_MREMOTENG_DECODED_BYTES ||
    decodedLength > budget.remainingDecodedBytes
  ) {
    throw new Error("mRemoteNG ciphertext exceeds the decode safety budget");
  }
  budget.remainingDecodedBytes -= decodedLength;
  let bin: string;
  try {
    bin = atob(clean);
  } catch {
    throw new Error("mRemoteNG ciphertext is not valid base64");
  }
  if (bin.length !== decodedLength) {
    throw new Error("mRemoteNG base64 length is inconsistent");
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

const encodeBase64 = (bytes: Uint8Array): string => {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
};

/**
 * Convert a password to bytes the way BouncyCastle's
 * `PbeParametersGenerator.Pkcs5PasswordToBytes` does: take the low byte of
 * each UTF-16 code unit. mRemoteNG's `Pkcs5S2KeyGenerator` calls this before
 * feeding the bytes to PBKDF2, so we MUST match it exactly - not UTF-8 - or
 * non-ASCII passwords (e.g. "passwört") will derive a different key.
 *
 * For any pure-ASCII password this is identical to UTF-8; for Latin-1 the
 * low-byte truncation is the same as ISO-8859-1; for code points > 0xFF
 * BouncyCastle silently loses the high bits and so do we.
 */
function pkcs5PasswordToBytes(password: string): Uint8Array {
  const out = new Uint8Array(password.length);
  for (let i = 0; i < password.length; i++) {
    out[i] = password.charCodeAt(i) & 0xff;
  }
  return out;
}

async function deriveMRemoteNGKey(
  password: string,
  salt: Uint8Array,
  iterations: number,
  usages: KeyUsage[] = ["decrypt"],
): Promise<CryptoKey> {
  const passKey = await crypto.subtle.importKey(
    "raw",
    asBufferSource(pkcs5PasswordToBytes(password)),
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-1", salt: asBufferSource(salt), iterations },
    passKey,
    { name: "AES-GCM", length: 256 },
    false,
    usages,
  );
}

/**
 * Decrypt a single base64-encoded mRemoteNG ciphertext (Protected attribute,
 * per-field Password, or full-file body). The output is the raw plaintext
 * bytes - caller decides whether to UTF-8 decode.
 */
async function decryptMRemoteNGBlob(
  payloadB64: string,
  password: string,
  iterations: number,
  budget: MRemoteNGDecodeBudget,
): Promise<Uint8Array> {
  const data = decodeBase64(payloadB64, budget);
  const minLen = MRNG_SALT_SIZE + MRNG_NONCE_SIZE + MRNG_TAG_SIZE;
  if (data.length < minLen) {
    throw new Error(
      `mRemoteNG ciphertext is too short (${data.length} bytes; need >= ${minLen})`,
    );
  }
  const salt = data.slice(0, MRNG_SALT_SIZE);
  const nonce = data.slice(MRNG_SALT_SIZE, MRNG_SALT_SIZE + MRNG_NONCE_SIZE);
  const ciphertext = data.slice(MRNG_SALT_SIZE + MRNG_NONCE_SIZE);
  const key = await deriveMRemoteNGKey(password, salt, iterations);
  const params: AesGcmParams = {
    name: "AES-GCM",
    iv: asBufferSource(nonce),
    additionalData: asBufferSource(salt),
    tagLength: MRNG_TAG_SIZE * 8,
  };
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt(
      params,
      key,
      asBufferSource(ciphertext),
    );
  } catch (primaryError) {
    // sortOfRemoteNG builds before this interop fix wrote AES-GCM blobs with
    // empty AAD. Keep that recovery path so existing exports can still import,
    // but prefer the upstream mRemoteNG salt-AAD format above.
    try {
      plain = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: asBufferSource(nonce),
          tagLength: MRNG_TAG_SIZE * 8,
        },
        key,
        asBufferSource(ciphertext),
      );
    } catch {
      throw primaryError;
    }
  }
  return new Uint8Array(plain);
}

/**
 * Encrypt a plaintext buffer in mRemoteNG's wire format. Used by tests
 * (and potentially future export) to round-trip our own implementation.
 */
export async function encryptMRemoteNGBlob(
  plaintext: Uint8Array | string,
  password: string,
  iterations: number,
): Promise<string> {
  if (
    typeof plaintext === "string" &&
    plaintext.length > MAX_MREMOTENG_PLAINTEXT_CODE_UNITS
  ) {
    throw new Error("mRemoteNG plaintext exceeds the encode safety limit");
  }
  const bytes =
    typeof plaintext === "string"
      ? new TextEncoder().encode(plaintext)
      : plaintext;
  if (bytes.byteLength > MAX_MREMOTENG_DECODED_BYTES) {
    throw new Error("mRemoteNG plaintext exceeds the encode safety limit");
  }
  const salt = crypto.getRandomValues(new Uint8Array(MRNG_SALT_SIZE));
  const nonce = crypto.getRandomValues(new Uint8Array(MRNG_NONCE_SIZE));
  const key = await deriveMRemoteNGKey(password, salt, iterations, ["encrypt"]);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: asBufferSource(nonce),
        additionalData: asBufferSource(salt),
        tagLength: MRNG_TAG_SIZE * 8,
      },
      key,
      asBufferSource(bytes),
    ),
  );
  const out = new Uint8Array(salt.length + nonce.length + ct.length);
  out.set(salt, 0);
  out.set(nonce, salt.length);
  out.set(ct, salt.length + nonce.length);
  return encodeBase64(out);
}

/**
 * Reject mRemoteNG files using cipher/mode combinations we can't decrypt in
 * the browser. WebCrypto only exposes AES-GCM; CCM/EAX would need a JS-side
 * implementation, and Serpent/Twofish would need a full block-cipher polyfill.
 *
 * Throws with a descriptive error on anything other than AES/GCM.
 */
function assertSupportedMRemoteNGCipher(root: Element): void {
  const engine = (root.getAttribute("EncryptionEngine") || "AES").toUpperCase();
  const mode = (root.getAttribute("BlockCipherMode") || "GCM").toUpperCase();
  if (engine === "AES" && mode === "GCM") return;
  if (engine !== "AES") {
    throw new Error(
      `Unsupported mRemoteNG block cipher "${engine}". Only AES is implemented in this build (Serpent and Twofish would require a JS polyfill).`,
    );
  }
  throw new Error(
    `Unsupported mRemoteNG block-cipher mode "${mode}". Only GCM is implemented in this build (CCM and EAX would require a JS polyfill).`,
  );
}

/**
 * Verify a candidate master password by decrypting the file's `Protected`
 * attribute and checking it matches one of the known plaintext sentinels.
 *
 * Returns:
 *   - `valid: true, isDefaultMaster: true`  → user never set a master, the
 *     literal "mR3m" decrypts everything in the file.
 *   - `valid: true, isDefaultMaster: false` → user set a custom master and
 *     `password` is correct.
 *   - `valid: false` → wrong password (or file uses an unsupported cipher).
 */
export interface MRemoteNGPasswordCheck {
  valid: boolean;
  isDefaultMaster: boolean;
  iterations: number;
  hasProtected: boolean;
}

const MAX_MREMOTENG_KDF_ITERATIONS = 2_000_000;

function readMRemoteNGKdfIterations(root: Element): number {
  const raw = root.getAttribute("KdfIterations") ?? "1000";
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new Error("mRemoteNG KdfIterations must be a positive integer");
  }
  const iterations = Number(raw);
  if (
    !Number.isSafeInteger(iterations) ||
    iterations > MAX_MREMOTENG_KDF_ITERATIONS
  ) {
    throw new Error(
      `mRemoteNG KdfIterations exceeds the safety limit of ${MAX_MREMOTENG_KDF_ITERATIONS}`,
    );
  }
  return iterations;
}

export async function verifyMRemoteNGPassword(
  content: string,
  password: string,
): Promise<MRemoteNGPasswordCheck> {
  assertImportTextWithinLimit(content);
  const doc = new DOMParser().parseFromString(content, "text/xml");
  const root = doc.querySelector("Connections");
  if (!root) throw new Error("Not an mRemoteNG file (no <Connections> root)");
  const iterations = readMRemoteNGKdfIterations(root);
  const protectedB64 = (root.getAttribute("Protected") || "").trim();
  if (!protectedB64) {
    return {
      valid: true,
      isDefaultMaster: true,
      iterations,
      hasProtected: false,
    };
  }
  try {
    const plain = await decryptMRemoteNGBlob(
      protectedB64,
      password,
      iterations,
      createMRemoteNGDecodeBudget(),
    );
    const text = new TextDecoder().decode(plain);
    if (text === PROTECTED_PLAINTEXT_NO_PASSWORD) {
      return {
        valid: true,
        isDefaultMaster: true,
        iterations,
        hasProtected: true,
      };
    }
    if (text === PROTECTED_PLAINTEXT_PASSWORD) {
      return {
        valid: true,
        isDefaultMaster: false,
        iterations,
        hasProtected: true,
      };
    }
    // Decryption succeeded but plaintext is unrecognised — that's still a
    // wrong password unless the sentinel changes upstream.
    return {
      valid: false,
      isDefaultMaster: false,
      iterations,
      hasProtected: true,
    };
  } catch {
    return {
      valid: false,
      isDefaultMaster: false,
      iterations,
      hasProtected: true,
    };
  }
}

// All per-field encrypted attributes on `<Node>` in mRemoteNG (per upstream
// `XmlConnectionsDeserializer`):
//   - `Password`           — added in ConfVersion ≥ 0.2 (always)
//   - `VNCProxyPassword`   — added in ConfVersion ≥ 1.7
//   - `RDGatewayPassword`  — added in ConfVersion ≥ 2.2
const MRNG_PER_FIELD_PASSWORD_ATTRS = [
  "Password",
  "VNCProxyPassword",
  "RDGatewayPassword",
];

/**
 * Decrypt every per-field encrypted attribute on `<Node>` elements in the
 * given XML document, mutating it in place. Empty values are left as-is.
 * Any field failure aborts the import. Treating ciphertext as a recovered
 * password would create a plausible-looking but unusable and unsafe result.
 */
async function decryptPerFieldPasswords(
  doc: Document,
  password: string,
  iterations: number,
  budget: MRemoteNGDecodeBudget,
): Promise<void> {
  const nodeList = doc.querySelectorAll("Node");
  if (
    nodeList.length > MAX_IMPORT_CONNECTIONS ||
    nodeList.length * MRNG_PER_FIELD_PASSWORD_ATTRS.length >
      MAX_MREMOTENG_ENCRYPTED_FIELDS
  ) {
    throw new Error("mRemoteNG encrypted field count exceeds the safety limit");
  }
  const nodes = Array.from(nodeList);
  for (const node of nodes) {
    for (const attr of MRNG_PER_FIELD_PASSWORD_ATTRS) {
      const enc = node.getAttribute(attr);
      if (!enc) continue;
      const plain = await decryptMRemoteNGBlob(
        enc,
        password,
        iterations,
        budget,
      );
      node.setAttribute(
        attr,
        new TextDecoder("utf-8", { fatal: true }).decode(plain),
      );
    }
  }
}

/**
 * Decrypt an mRemoteNG XML using the supplied master password. Handles both
 * full-file encryption (entire `<Connections>` body is one blob) and
 * per-field-only encryption (individual `Password` attributes are blobs).
 *
 * Returns XML where `<Node>` elements are plaintext and (where possible)
 * `Password` attributes are decrypted. Verifies the password against the
 * `Protected` attribute first; throws on mismatch with a clear error.
 *
 * Only AES-256-GCM is implemented — Serpent / Twofish / CCM / EAX variants
 * fall through with an explicit error so callers can surface "unsupported".
 */
export async function decryptMRemoteNGXml(
  content: string,
  password: string,
): Promise<string> {
  assertImportTextWithinLimit(content);
  const doc = new DOMParser().parseFromString(content, "text/xml");
  const root = doc.querySelector("Connections");
  if (!root) throw new Error("Not an mRemoteNG file (no <Connections> root)");

  assertSupportedMRemoteNGCipher(root);
  const iterations = readMRemoteNGKdfIterations(root);
  const fullFileAttr = (
    root.getAttribute("FullFileEncryption") || ""
  ).toLowerCase();
  const fullFileEncryption = fullFileAttr === "true" || fullFileAttr === "1";
  const decodeBudget = createMRemoteNGDecodeBudget();

  // Validate password against the Protected sentinel before doing any work.
  const protectedB64 = (root.getAttribute("Protected") || "").trim();
  if (protectedB64) {
    const check = await verifyMRemoteNGPassword(content, password);
    if (!check.valid) {
      throw new Error("Incorrect master password");
    }
  }

  if (fullFileEncryption) {
    const body = (root.textContent || "").trim();
    if (!body) throw new Error("FullFileEncryption is on but body is empty");
    const innerBytes = await decryptMRemoteNGBlob(
      body,
      password,
      iterations,
      decodeBudget,
    );
    const innerXml = new TextDecoder("utf-8", { fatal: true }).decode(
      innerBytes,
    );
    // Rebuild a parseable document, preserving the original root attributes
    // so any post-processing can still see them.
    const wrapped = `<?xml version="1.0" encoding="utf-8"?><Connections ConfVersion="${root.getAttribute("ConfVersion") || "2.6"}">${innerXml}</Connections>`;
    const innerDoc = new DOMParser().parseFromString(wrapped, "text/xml");
    const parseError = innerDoc.querySelector("parsererror");
    if (parseError) {
      throw new Error(
        "Decrypted body is not valid XML — file may be from an unsupported mRemoteNG version",
      );
    }
    await decryptPerFieldPasswords(
      innerDoc,
      password,
      iterations,
      decodeBudget,
    );
    return new XMLSerializer().serializeToString(innerDoc);
  }

  // No full-file encryption — just decrypt per-field Password attributes.
  await decryptPerFieldPasswords(doc, password, iterations, decodeBudget);
  return new XMLSerializer().serializeToString(doc);
}

/**
 * Encrypt every per-field password attribute on `<Node>` elements in the
 * given XML document, mutating it in place. Empty values are left as-is.
 */
async function encryptPerFieldPasswords(
  doc: Document,
  password: string,
  iterations: number,
): Promise<void> {
  const nodes = Array.from(doc.querySelectorAll("Node"));
  for (const node of nodes) {
    for (const attr of MRNG_PER_FIELD_PASSWORD_ATTRS) {
      const plain = node.getAttribute(attr);
      if (!plain) continue;
      const ct = await encryptMRemoteNGBlob(plain, password, iterations);
      node.setAttribute(attr, ct);
    }
  }
}

export interface EncryptMRemoteNGOptions {
  /** Master password to encrypt with. Use `mR3m` for the no-master case. */
  password: string;
  /** PBKDF2 iterations to record in the file header. mRemoteNG's minimum is 1000. */
  iterations?: number;
  /** When true, encrypt the entire `<Node>` tree as one blob. */
  fullFileEncryption?: boolean;
  /** Existing root attributes to preserve (Name, Export, etc.). */
  rootAttributes?: Record<string, string>;
}

/**
 * Build an mRemoteNG-format encrypted XML file from a plaintext `<Connections>`
 * document. Produces output that round-trips through `decryptMRemoteNGXml`,
 * including:
 *   - `Protected` attribute set to the canonical sentinel (`ThisIsNotProtected`
 *     for `mR3m`, `ThisIsProtected` for any other password).
 *   - All `EncryptionEngine`, `BlockCipherMode`, `KdfIterations`,
 *     `FullFileEncryption` headers populated to match upstream conventions.
 *   - Every per-field `Password` / `VNCProxyPassword` / `RDGatewayPassword`
 *     attribute encrypted before serialization.
 *   - When `fullFileEncryption` is set, the entire `<Node>` tree is replaced
 *     by one base64 blob inside the root.
 *
 * The input must be a `<Connections>…</Connections>` XML string with `<Node>`
 * children; attributes other than the encryption headers are preserved.
 */
export async function encryptMRemoteNGXml(
  plainXml: string,
  opts: EncryptMRemoteNGOptions,
): Promise<string> {
  const password = opts.password;
  if (!password) throw new Error("encryptMRemoteNGXml requires a password");
  const requestedIterations = opts.iterations ?? 1000;
  if (
    !Number.isSafeInteger(requestedIterations) ||
    requestedIterations < 1 ||
    requestedIterations > MAX_MREMOTENG_KDF_ITERATIONS
  ) {
    throw new Error(
      `mRemoteNG KdfIterations must be a positive integer no greater than ${MAX_MREMOTENG_KDF_ITERATIONS}`,
    );
  }
  const iterations = Math.max(1000, requestedIterations);

  const doc = new DOMParser().parseFromString(plainXml, "text/xml");
  const parseError = doc.querySelector("parsererror");
  if (parseError) throw new Error("Input is not valid XML");
  const root = doc.querySelector("Connections");
  if (!root) throw new Error("Input must have a <Connections> root");

  // Preserve any caller-supplied root attributes, then overwrite the
  // encryption headers so the file is self-describing.
  if (opts.rootAttributes) {
    for (const [k, v] of Object.entries(opts.rootAttributes)) {
      root.setAttribute(k, v);
    }
  }
  if (!root.hasAttribute("Name")) root.setAttribute("Name", "Connections");
  if (!root.hasAttribute("Export")) root.setAttribute("Export", "false");
  if (!root.hasAttribute("ConfVersion"))
    root.setAttribute("ConfVersion", "2.6");
  root.setAttribute("EncryptionEngine", "AES");
  root.setAttribute("BlockCipherMode", "GCM");
  root.setAttribute("KdfIterations", String(iterations));
  root.setAttribute(
    "FullFileEncryption",
    opts.fullFileEncryption ? "true" : "false",
  );

  // Generate the Protected sentinel for this master.
  const sentinel =
    password === MREMOTENG_DEFAULT_MASTER_PASSWORD
      ? "ThisIsNotProtected"
      : "ThisIsProtected";
  const protectedB64 = await encryptMRemoteNGBlob(
    sentinel,
    password,
    iterations,
  );
  root.setAttribute("Protected", protectedB64);

  // Always encrypt per-field passwords, regardless of full-file mode (real
  // mRemoteNG files always do; the full-file mode just adds a wrapper on top).
  await encryptPerFieldPasswords(doc, password, iterations);

  if (opts.fullFileEncryption) {
    // Serialize the inner content (children of <Connections>) and replace it
    // with a single encrypted blob.
    const inner = Array.from(root.childNodes)
      .map((n) => new XMLSerializer().serializeToString(n))
      .join("");
    while (root.firstChild) root.removeChild(root.firstChild);
    const ct = await encryptMRemoteNGBlob(inner, password, iterations);
    root.appendChild(doc.createTextNode(ct));
  }

  return new XMLSerializer().serializeToString(doc);
}

export const detectMRemoteNGEncryption = (
  content: string,
): MRemoteNGEncryptionInfo => {
  const empty: MRemoteNGEncryptionInfo = {
    isEncrypted: false,
    fullFileEncryption: false,
    requiresPassword: false,
  };
  try {
    const doc = new DOMParser().parseFromString(content, "text/xml");
    const root = doc.querySelector("Connections");
    if (!root) return empty;
    const fullFileAttr = (
      root.getAttribute("FullFileEncryption") || ""
    ).toLowerCase();
    const fullFileEncryption = fullFileAttr === "true" || fullFileAttr === "1";
    const protectedAttr = (root.getAttribute("Protected") || "").trim();
    const hasProtected = protectedAttr.length > 0;
    const childNodeCount = root.querySelectorAll(":scope > Node").length;
    // Full-file encryption: body is one encrypted blob, no <Node> children present
    // (or the file explicitly advertises FullFileEncryption="true").
    const requiresPassword =
      fullFileEncryption || (hasProtected && childNodeCount === 0);
    return {
      isEncrypted: hasProtected || fullFileEncryption,
      fullFileEncryption: fullFileEncryption || requiresPassword,
      requiresPassword,
    };
  } catch {
    return empty;
  }
};

/**
 * Parse mRemoteNG XML format
 * mRemoteNG uses a nested Node structure with attributes for connection properties
 */
export const importFromMRemoteNG = async (
  content: string,
): Promise<Connection[]> => {
  assertImportTextWithinLimit(content);
  const parser = new DOMParser();
  const doc = parser.parseFromString(content, "text/xml");

  // Check for parse errors
  const parseError = doc.querySelector("parsererror");
  if (parseError) {
    throw new Error("Invalid XML format: " + parseError.textContent);
  }
  getBoundedXmlElements(doc, "Node");

  const connections: Connection[] = [];
  const folderIdMap = new Map<Element, string>();
  const pendingSshTunnels: Array<{
    connectionId: string;
    tunnelConnectionName: string;
    targetHost: string;
    targetPort: number;
  }> = [];

  // Recursive function to parse nodes
  const parseNode = (
    node: Element,
    parentId?: string,
    inheritedTunnelName?: string,
    inheritedProps?: MRemoteNGInheritableProps,
  ): void => {
    const nodeType = node.getAttribute("Type") || "Connection";
    const name = node.getAttribute("Name") || "Unnamed";
    const sshTunnelConnectionName = resolveMRemoteNGSshTunnelName(
      node,
      inheritedTunnelName,
    );

    if (nodeType === "Container") {
      // This is a folder
      const folderId = generateId();
      const expanded =
        (node.getAttribute("Expanded") || "").toLowerCase() === "true";
      folderIdMap.set(node, folderId);

      connections.push({
        id: folderId,
        name: name,
        protocol: "rdp", // group placeholder
        hostname: "",
        port: 0,
        isGroup: true,
        expanded,
        parentId: parentId,
        description: node.getAttribute("Descr") || undefined,
        tags: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // A container can itself carry connection-shaped attributes (Username,
      // Password, …) plus its own `Inherit*` flags that pull from ITS parent.
      // Resolve the values the container exposes to its children (R7), so a
      // multi-level folder hierarchy propagates credentials correctly.
      const containerProps: MRemoteNGInheritableProps = {
        username: resolveMRemoteNGInheritedProp(
          node,
          "Username",
          "InheritUsername",
          inheritedProps?.username,
        ),
        password: resolveMRemoteNGInheritedProp(
          node,
          "Password",
          "InheritPassword",
          inheritedProps?.password,
        ),
        domain: resolveMRemoteNGInheritedProp(
          node,
          "Domain",
          "InheritDomain",
          inheritedProps?.domain,
        ),
        hostname: resolveMRemoteNGInheritedProp(
          node,
          "Hostname",
          "InheritHostname",
          inheritedProps?.hostname,
        ),
        port: resolveMRemoteNGInheritedProp(
          node,
          "Port",
          "InheritPort",
          inheritedProps?.port,
        ),
        protocol: resolveMRemoteNGProtocol(node, inheritedProps?.protocol),
      };

      // Parse child nodes
      const children = node.querySelectorAll(":scope > Node");
      children.forEach((child) =>
        parseNode(child, folderId, sshTunnelConnectionName, containerProps),
      );
    } else {
      // This is a connection
      // Resolve protocol/host/port/credentials honouring container
      // inheritance (R7, RC3), then classify by evidence: protocol string,
      // port, and any scheme prefix on Hostname (t71 RC2/RC4).
      const endpoint = resolveImportedEndpoint(
        resolveMRemoteNGProtocol(node, inheritedProps?.protocol),
        resolveMRemoteNGInheritedProp(
          node,
          "Hostname",
          "InheritHostname",
          inheritedProps?.hostname,
        ),
        resolveMRemoteNGInheritedProp(
          node,
          "Port",
          "InheritPort",
          inheritedProps?.port,
        ),
      );
      const { hostname, port } = endpoint;
      const username =
        resolveMRemoteNGInheritedProp(
          node,
          "Username",
          "InheritUsername",
          inheritedProps?.username,
        ) || undefined;
      const password =
        resolveMRemoteNGInheritedProp(
          node,
          "Password",
          "InheritPassword",
          inheritedProps?.password,
        ) || undefined;
      const domain =
        resolveMRemoteNGInheritedProp(
          node,
          "Domain",
          "InheritDomain",
          inheritedProps?.domain,
        ) || undefined;
      const description =
        node.getAttribute("Descr") ||
        node.getAttribute("Description") ||
        undefined;

      // mRemoteNG specific fields
      const resolution = node.getAttribute("Resolution") || undefined;
      const colors = node.getAttribute("Colors") || undefined;
      const useCredSsp = node.getAttribute("UseCredSsp") === "True";
      const renderingEngine = node.getAttribute("RenderingEngine") || undefined;
      const connectionId = generateId();

      connections.push({
        id: connectionId,
        name: name,
        protocol: endpoint.protocol,
        hostname: hostname,
        port: port,
        username: username,
        password: password,
        domain: domain,
        description: description,
        parentId: parentId,
        isGroup: false,
        tags: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        // Store mRemoteNG-specific settings in custom fields
        ...(resolution && { resolution }),
        ...(colors && { colorDepth: colors }),
        ...(useCredSsp !== undefined && { useCredSsp }),
        ...(renderingEngine && { renderingEngine }),
        ...rawSocketSettingsFor(endpoint),
      });

      if (sshTunnelConnectionName) {
        pendingSshTunnels.push({
          connectionId,
          tunnelConnectionName: sshTunnelConnectionName,
          targetHost: hostname,
          targetPort: port,
        });
      }
    }
  };

  // Get the root Connections element or find Node elements directly
  const rootConnections = doc.querySelector("Connections");
  const rootNodes = rootConnections
    ? rootConnections.querySelectorAll(":scope > Node")
    : doc.querySelectorAll("Node");

  rootNodes.forEach((node) => parseNode(node));

  // Jump/bastion hosts referenced by `SSHTunnelConnectionName` are SSH
  // connections. mRemoteNG resolves the tunnel target by NAME across the whole
  // tree; when names collide we deterministically prefer the FIRST occurrence
  // in tree order (R8). `connections` is populated in document order by the
  // recursive parse above, so a first-write-wins map yields that ordering.
  const sshConnections = connections.filter(
    (connection) => !connection.isGroup && connection.protocol === "ssh",
  );
  const sshConnectionsByName = new Map<string, Connection>();
  const sshConnectionsByLowerName = new Map<string, Connection>();
  for (const connection of sshConnections) {
    if (!sshConnectionsByName.has(connection.name)) {
      sshConnectionsByName.set(connection.name, connection);
    }
    const lower = connection.name.toLowerCase();
    if (!sshConnectionsByLowerName.has(lower)) {
      sshConnectionsByLowerName.set(lower, connection);
    }
  }

  pendingSshTunnels.forEach((pending) => {
    const targetConnection = connections.find(
      (connection) => connection.id === pending.connectionId,
    );
    if (!targetConnection) return;

    const tunnelConnection =
      sshConnectionsByName.get(pending.tunnelConnectionName) ||
      sshConnectionsByLowerName.get(pending.tunnelConnectionName.toLowerCase());
    const tunnelHost = tunnelConnection?.hostname?.trim() || "";
    const tunnelPort =
      tunnelConnection && Number.isFinite(Number(tunnelConnection.port))
        ? Number(tunnelConnection.port)
        : 22;

    // §1.4 contract: SSH targets use a `ssh-jump` layer (the SSH runtime
    // resolver treats it as a jump host); every other protocol (RDP/VNC/HTTP/…)
    // uses a `ssh-tunnel` layer consumed by the per-protocol tunnel runtime.
    // The `connectionId` reference is always kept (for re-resolution against the
    // connection store) and inline host/port/creds are inlined whenever the
    // jump host resolves.
    const layerType: TunnelType =
      targetConnection.protocol === "ssh" ? "ssh-jump" : "ssh-tunnel";

    const layer: TunnelChainLayer = {
      id: generateId(),
      type: layerType,
      enabled: Boolean(tunnelHost),
      name: `mRemoteNG SSH tunnel via ${pending.tunnelConnectionName}`,
      localBindHost: "127.0.0.1",
      localBindPort: 0,
      sshTunnel: {
        forwardType: "local",
        ...(tunnelConnection?.id && { connectionId: tunnelConnection.id }),
        ...(tunnelHost && { host: tunnelHost }),
        port: tunnelPort > 0 ? tunnelPort : 22,
        ...(tunnelConnection?.username && {
          username: tunnelConnection.username,
        }),
        ...(tunnelConnection?.password && {
          password: tunnelConnection.password,
        }),
        remoteHost: pending.targetHost || "localhost",
        remotePort: pending.targetPort,
      },
    };

    targetConnection.security = {
      ...targetConnection.security,
      tunnelChain: [...(targetConnection.security?.tunnelChain ?? []), layer],
    };
  });

  return connections.map(normalizeImportedAdvancedProtocolConnection);
};

/**
 * Parse Remote Desktop Connection Manager (RDCMan) XML format
 */
export const importFromRDCMan = async (
  content: string,
): Promise<Connection[]> => {
  assertImportTextWithinLimit(content);
  const parser = new DOMParser();
  const doc = parser.parseFromString(content, "text/xml");

  const parseError = doc.querySelector("parsererror");
  if (parseError) {
    throw new Error("Invalid XML format: " + parseError.textContent);
  }
  getBoundedXmlElements(doc, "group, server");

  const connections: Connection[] = [];

  // Parse groups
  const parseGroup = (groupEl: Element, parentId?: string): void => {
    const properties = groupEl.querySelector(":scope > properties");
    const name =
      properties?.querySelector("name")?.textContent || "Unnamed Group";
    const groupId = generateId();

    connections.push({
      id: groupId,
      name: name,
      protocol: "rdp",
      hostname: "",
      port: 0,
      isGroup: true,
      parentId: parentId,
      tags: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Parse servers in this group
    groupEl.querySelectorAll(":scope > server").forEach((serverEl) => {
      parseRDCManServer(serverEl, connections, groupId);
    });

    // Recursively parse subgroups
    groupEl.querySelectorAll(":scope > group").forEach((subGroupEl) => {
      parseGroup(subGroupEl, groupId);
    });
  };

  // Start parsing from file > group elements
  doc.querySelectorAll("file > group").forEach((groupEl) => {
    parseGroup(groupEl);
  });

  // Also check for servers at root level
  doc.querySelectorAll("file > server").forEach((serverEl) => {
    parseRDCManServer(serverEl, connections);
  });

  return connections.map(normalizeImportedAdvancedProtocolConnection);
};

/** Extract a single RDCMan server element into a Connection. */
const parseRDCManServer = (
  serverEl: Element,
  connections: Connection[],
  parentId?: string,
): void => {
  const props = serverEl.querySelector("properties");
  const displayName = props?.querySelector("displayName")?.textContent;
  const serverName = props?.querySelector("name")?.textContent || "";

  // RDCMan stores credentials in <logonCredentials> (group or server level)
  const creds = serverEl.querySelector("logonCredentials");
  const username = creds?.querySelector("userName")?.textContent || undefined;
  const domain = creds?.querySelector("domain")?.textContent || undefined;

  // Port lives in <connectionSettings>
  const connSettings = serverEl.querySelector("connectionSettings");
  const port =
    parseImportedPort(connSettings?.querySelector("port")?.textContent) ??
    DEFAULT_PORTS.rdp;

  // Comment/description
  const comment = props?.querySelector("comment")?.textContent || undefined;

  connections.push({
    id: generateId(),
    name: displayName || serverName,
    protocol: "rdp",
    hostname: serverName,
    port,
    username,
    domain,
    description: comment,
    isGroup: false,
    parentId,
    tags: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
};

/**
 * Parse MobaXterm bookmarks INI format
 */
export const importFromMobaXterm = async (
  content: string,
): Promise<Connection[]> => {
  assertImportTextWithinLimit(content);
  const connections: Connection[] = [];
  const lines = content.split(/\r?\n/);
  let currentSection = "";
  let currentSubRep = "";
  const folderMap = new Map<string, string>();

  for (const line of lines) {
    const trimmed = line.trim();

    // Section header
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      currentSection = trimmed.slice(1, -1);
      continue;
    }

    if (
      currentSection === "Bookmarks" ||
      currentSection.startsWith("Bookmarks_")
    ) {
      // Parse SubRep (folder path)
      if (trimmed.startsWith("SubRep=")) {
        currentSubRep = trimmed.slice(7);
        if (currentSubRep && !folderMap.has(currentSubRep)) {
          const folderId = generateId();
          folderMap.set(currentSubRep, folderId);
          assertCanAppendConnection(connections.length);
          connections.push({
            id: folderId,
            name: currentSubRep.split("\\").pop() || currentSubRep,
            protocol: "ssh",
            hostname: "",
            port: 0,
            isGroup: true,
            tags: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
        }
        continue;
      }

      // Parse bookmark entry
      // Format: Name=#sessionType#hostname%port%username%...
      const match = trimmed.match(/^(.+?)=#(\d+)#(.+)/);
      if (match) {
        const [, name, typeNum, params] = match;
        const parts = params.split("%");
        const hostname = parts[0] || "";
        // Map MobaXterm session types
        const protocolMap: Record<string, Connection["protocol"]> = {
          "0": "ssh", // SSH
          "1": "telnet", // Telnet
          "2": "rlogin", // Rlogin
          "4": "rdp", // RDP
          "5": "vnc", // VNC
          "3": "xdmcp", // XDMCP
          "6": "ftp", // FTP
          "7": "sftp", // SFTP (map to SSH)
          "8": "ssh", // Mosh (→ ssh)
          "9": "telnet", // Serial (→ telnet)
          "10": "ssh", // WSL
        };
        // Unknown session types are classified by evidence (port / scheme)
        // and only default to SSH — MobaXterm's own default — when there is
        // no evidence at all.
        const mapped = protocolMap[typeNum];
        const inferred = mapped
          ? undefined
          : normalizeImportedProtocol({ port: parts[1], url: hostname });
        const protocol: Connection["protocol"] =
          mapped ??
          (inferred && inferred.source !== "fallback"
            ? inferred.protocol
            : "ssh");
        const port = parsePortOrDefault(parts[1], protocol);
        const username = parts[2] || undefined;

        assertCanAppendConnection(connections.length);
        connections.push({
          id: generateId(),
          name: name,
          protocol,
          hostname: hostname,
          port: port,
          username: username,
          isGroup: false,
          parentId: currentSubRep ? folderMap.get(currentSubRep) : undefined,
          tags: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
    }
  }

  return connections.map(normalizeImportedAdvancedProtocolConnection);
};

/**
 * Parse PuTTY registry export format
 */
export const importFromPuTTY = async (
  content: string,
): Promise<Connection[]> => {
  assertImportTextWithinLimit(content);
  const connections: Connection[] = [];
  const lines = content.split(/\r?\n/);
  let currentSession: string | null = null;
  let currentProps: Record<string, string> = {};

  for (const line of lines) {
    const trimmed = line.trim();

    // Session header
    const sessionMatch = trimmed.match(
      /\[HKEY_CURRENT_USER\\Software\\SimonTatham\\PuTTY\\Sessions\\(.+)\]/,
    );
    if (sessionMatch) {
      // Save previous session
      if (currentSession && currentProps.HostName) {
        assertCanAppendConnection(connections.length);
        connections.push(createPuTTYConnection(currentSession, currentProps));
      }
      currentSession = decodeURIComponent(
        sessionMatch[1].replace(/%([0-9A-F]{2})/gi, (_, hex) =>
          String.fromCharCode(parseInt(hex, 16)),
        ),
      );
      currentProps = {};
      continue;
    }

    // Property line
    const propMatch = trimmed.match(/"(.+?)"=(?:"(.*)"|dword:([0-9a-f]+))/);
    if (propMatch && currentSession) {
      const [, key, strValue, dwordValue] = propMatch;
      currentProps[key] = strValue ?? String(parseInt(dwordValue || "0", 16));
    }
  }

  // Save last session
  if (currentSession && currentProps.HostName) {
    assertCanAppendConnection(connections.length);
    connections.push(createPuTTYConnection(currentSession, currentProps));
  }

  return connections.map(normalizeImportedAdvancedProtocolConnection);
};

const createPuTTYConnection = (
  name: string,
  props: Record<string, string>,
): Connection => {
  const protocolMap: Record<string, Connection["protocol"]> = {
    ssh: "ssh",
    serial: "telnet",
    telnet: "telnet",
    rlogin: "rlogin",
    raw: "raw",
    "raw/tcp": "raw",
    "raw/udp": "raw",
    powershell: "winrm",
    winrm: "winrm",
  };

  const sourceProtocol = props.Protocol?.toLowerCase() || "ssh";
  const portableProtocol = mapPortableProtocol(sourceProtocol);
  const inferred = normalizeImportedProtocol({
    raw: protocolMap[sourceProtocol] ? undefined : sourceProtocol,
    port: props.PortNumber,
    url: props.HostName,
  });
  const protocol: Connection["protocol"] =
    portableProtocol.rawTransport || portableProtocol.protocol === "winrm"
      ? portableProtocol.protocol
      : (protocolMap[sourceProtocol] ??
        (inferred.source !== "fallback" ? inferred.protocol : "ssh"));

  return {
    id: generateId(),
    name: name,
    protocol,
    hostname: props.HostName,
    port: parsePortOrDefault(props.PortNumber, protocol),
    username: props.UserName || undefined,
    isGroup: false,
    tags: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...(portableProtocol.rawTransport
      ? {
          rawSocketSettings: createDefaultRawSocketSettings(
            portableProtocol.rawTransport,
          ),
        }
      : {}),
  };
};

/**
 * Parse Termius JSON export format
 */
export const importFromTermius = async (
  content: string,
): Promise<Connection[]> => {
  assertImportTextWithinLimit(content);
  const data = JSON.parse(content);
  assertJsonStructureWithinLimits(data);
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Termius import must contain a JSON object");
  }
  const groupCount = Array.isArray(data.groups) ? data.groups.length : 0;
  const hostCount = Array.isArray(data.hosts) ? data.hosts.length : 0;
  assertCanAppendConnection(groupCount, hostCount);
  const connections: Connection[] = [];
  const groupMap = new Map<string, string>();

  // Parse groups first
  if (data.groups) {
    for (const group of data.groups) {
      const groupId = generateId();
      groupMap.set(group.id || group.label, groupId);
      connections.push({
        id: groupId,
        name: group.label || "Unnamed Group",
        protocol: "ssh",
        hostname: "",
        port: 0,
        isGroup: true,
        tags: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
  }

  // Parse hosts
  if (data.hosts) {
    for (const host of data.hosts) {
      // Termius stores username either at top-level or inside ssh_config
      const username = host.username || host.ssh_config?.username || undefined;

      connections.push({
        id: generateId(),
        name: host.label || host.address || "Unnamed",
        protocol: "ssh",
        hostname: host.address || "",
        port: parsePortOrDefault(host.port, "ssh"),
        username,
        isGroup: false,
        parentId: host.group_id ? groupMap.get(host.group_id) : undefined,
        tags: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
  }

  return connections.map(normalizeImportedAdvancedProtocolConnection);
};

/**
 * Parse Royal TS/TSX JSON export format.
 * Royal TS exports nested Objects arrays with Type indicating the object kind.
 */
export const importFromRoyalTS = async (
  content: string,
): Promise<Connection[]> => {
  assertImportTextWithinLimit(content);
  const data = JSON.parse(content);
  assertJsonStructureWithinLimits(data);
  if (
    !Array.isArray(data) &&
    (!data || typeof data !== "object" || !Array.isArray(data.Objects))
  ) {
    throw new Error("Royal TS import must contain an object array");
  }
  const connections: Connection[] = [];

  const mapRoyalType = (type: string): Connection["protocol"] | undefined => {
    const map: Record<string, Connection["protocol"]> = {
      RoyalRDSConnection: "rdp",
      RoyalSSHConnection: "ssh",
      RoyalVNCConnection: "vnc",
      RoyalSFTPConnection: "ssh",
      RoyalFTPConnection: "ftp",
      RoyalTelnetConnection: "telnet",
      RoyalRLoginConnection: "rlogin",
      RoyalRawConnection: "raw",
      RoyalPowerShellConnection: "winrm",
      RoyalWebConnection: "https",
    };
    return map[type];
  };

  const parseObjects = (objects: any[], parentId?: string, depth = 0): void => {
    if (depth > MAX_IMPORT_NESTING_DEPTH) {
      throw new Error("Royal TS nesting exceeds the safety limit");
    }
    if (
      !Array.isArray(objects) ||
      connections.length + objects.length > MAX_IMPORT_CONNECTIONS
    ) {
      throw new Error("Royal TS object count exceeds the safety limit");
    }
    for (const obj of objects) {
      if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
        throw new Error("Royal TS contains a malformed object");
      }
      if (obj.Type === "RoyalFolder") {
        assertCanAppendConnection(connections.length);
        const folderId = generateId();
        connections.push({
          id: folderId,
          name: obj.Name || "Unnamed Folder",
          protocol: "rdp", // group placeholder
          hostname: "",
          port: 0,
          isGroup: true,
          parentId,
          description: obj.Description || undefined,
          tags: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        if (obj.Objects && Array.isArray(obj.Objects)) {
          parseObjects(obj.Objects, folderId, depth + 1);
        }
      } else {
        assertCanAppendConnection(connections.length);
        // Known Royal types map directly; anything else (and web objects,
        // whose URI carries the scheme) is classified by evidence.
        const endpoint = resolveImportedEndpoint(
          mapRoyalType(obj.Type || "") ?? obj.Type,
          obj.URI || obj.ComputerName || "",
          obj.Port,
        );
        connections.push({
          id: generateId(),
          name: obj.Name || obj.URI || "Unnamed",
          protocol: endpoint.protocol,
          hostname: endpoint.hostname,
          port: endpoint.port,
          username: obj.CredentialUsername || obj.Username || undefined,
          domain: obj.CredentialDomain || undefined,
          description: obj.Description || undefined,
          isGroup: false,
          parentId,
          tags: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
    }
  };

  const objects = data.Objects || (Array.isArray(data) ? data : []);
  parseObjects(objects);
  return connections.map(normalizeImportedAdvancedProtocolConnection);
};

/**
 * Parse SecureCRT XML session export format.
 * SecureCRT uses non-standard XML tag names like <S:"Hostname"> which DOMParser
 * cannot handle, so we use regex-based parsing instead.
 */
export const importFromSecureCRT = async (
  content: string,
): Promise<Connection[]> => {
  assertImportTextWithinLimit(content);
  const connections: Connection[] = [];

  // Match each <Session Name="...">...</Session> block
  const sessionRegex = /<Session\s+Name="([^"]*)">([\s\S]*?)<\/Session>/g;
  let match;

  while ((match = sessionRegex.exec(content)) !== null) {
    const nameAttr = match[1];
    const body = match[2];

    const nameParts = nameAttr.split("/");
    const name = nameParts[nameParts.length - 1] || nameAttr;

    let hostname = "";
    let rawPort: string | undefined;
    let username = "";
    let protocol: Connection["protocol"] = "ssh";
    let unmappedProtocolName: string | undefined;

    // Extract string values: <S:"Key">value</S:"Key">
    const strRegex = /<S:"([^"]+)">([^<]*)<\/S:"[^"]+">/g;
    let strMatch;
    while ((strMatch = strRegex.exec(body)) !== null) {
      const key = strMatch[1];
      const value = strMatch[2];
      if (key === "Hostname") hostname = value;
      else if (key === "Username") username = value;
      else if (key === "Protocol Name") {
        const lower = value.trim().toLowerCase();
        if (lower.includes("ssh")) protocol = "ssh";
        else if (lower.includes("telnet")) protocol = "telnet";
        else if (lower === "rlogin" || lower === "r-login") protocol = "rlogin";
        else if (["raw", "raw/tcp", "raw tcp"].includes(lower))
          protocol = "raw";
        else if (["raw/udp", "raw udp"].includes(lower)) protocol = "raw";
        else if (lower.includes("powershell") || lower === "winrm")
          protocol = "winrm";
        else unmappedProtocolName = value.trim();
      }
    }

    // Extract integer values: <D:"Key">value</D:"Key">
    const intRegex = /<D:"([^"]+)">([^<]*)<\/D:"[^"]+">/g;
    let intMatch;
    while ((intMatch = intRegex.exec(body)) !== null) {
      const key = intMatch[1];
      const value = intMatch[2];
      if (key === "[SSH2] Port" || key === "Port") {
        rawPort = value;
      }
    }

    if (unmappedProtocolName) {
      // Not one of SecureCRT's shell protocols: classify by evidence and keep
      // the SSH default only when there is none.
      const inferred = normalizeImportedProtocol({
        raw: unmappedProtocolName,
        port: rawPort,
        url: hostname,
      });
      if (inferred.source !== "fallback") protocol = inferred.protocol;
    }
    const port = parsePortOrDefault(rawPort, protocol);

    if (hostname || name) {
      assertCanAppendConnection(connections.length);
      const portableProtocol = mapPortableProtocol(
        protocol === "raw"
          ? body.toLowerCase().includes("raw/udp") ||
            body.toLowerCase().includes("raw udp")
            ? "raw/udp"
            : "raw/tcp"
          : protocol,
      );
      connections.push({
        id: generateId(),
        name: name || hostname,
        protocol,
        hostname,
        port,
        username: username || undefined,
        isGroup: false,
        tags: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...(portableProtocol.rawTransport
          ? {
              rawSocketSettings: createDefaultRawSocketSettings(
                portableProtocol.rawTransport,
              ),
            }
          : {}),
      });
    }
  }

  return connections.map(normalizeImportedAdvancedProtocolConnection);
};

const dropImportedProxyCommandConfirmation = (
  override: Connection["sshConnectionConfigOverride"],
): Connection["sshConnectionConfigOverride"] => {
  if (!override) return override;

  const { proxyCommandConfirmed: _proxyCommandConfirmed, ...safeOverride } =
    override;
  return safeOverride;
};

/**
 * Parse generic JSON format
 */
const normalizeJsonConnection = (conn: any): Connection => {
  const isGroup = Boolean(conn.isGroup || conn.isFolder);
  const rawProtocol = conn.protocol ?? conn.type;
  // Accept `type`/`url`/`address` aliases; a `url` field is protocol
  // evidence even when `hostname` is given separately.
  const endpoint = resolveImportedEndpoint(
    rawProtocol,
    conn.hostname || conn.host || conn.address || conn.url || "",
    conn.port,
    conn.url,
  );
  const protocol: Connection["protocol"] =
    isGroup && !rawProtocol ? "rdp" /* group placeholder */ : endpoint.protocol;
  return normalizeImportedAdvancedProtocolConnection({
    ...conn,
    ...(conn.rawSocketSettings ? {} : rawSocketSettingsFor(endpoint)),
    // Keep the source alias for RAW so a legacy `rawSocketSettings` block is
    // migrated to the transport the alias names (`raw_udp` → udp).
    protocol: (endpoint.rawTransport && rawProtocol
      ? rawProtocol
      : protocol) as Connection["protocol"],
    id: conn.id || generateId(),
    name: conn.name || "Imported Connection",
    hostname: endpoint.hostname,
    port: endpoint.port,
    username: conn.username || undefined,
    password: conn.password || undefined,
    domain: conn.domain || undefined,
    description: conn.description || undefined,
    parentId: conn.parentId || undefined,
    isGroup,
    tags: conn.tags || [],
    createdAt: new Date(conn.createdAt || Date.now()).toISOString(),
    updatedAt: new Date(conn.updatedAt || Date.now()).toISOString(),
    sshConnectionConfigOverride: dropImportedProxyCommandConfirmation(
      conn.sshConnectionConfigOverride,
    ),
  } as Connection);
};

export const importFromJSON = async (
  content: string,
): Promise<Connection[]> => {
  assertImportTextWithinLimit(content);
  const data = JSON.parse(content);
  assertJsonStructureWithinLimits(data);
  const normalizeConnections = (connections: unknown[]): Connection[] => {
    if (connections.length > MAX_IMPORT_CONNECTIONS) {
      throw new Error("JSON connection count exceeds the safety limit");
    }
    return connections.map((connection) => {
      if (
        !connection ||
        typeof connection !== "object" ||
        Array.isArray(connection)
      ) {
        throw new Error("JSON import contains a malformed connection");
      }
      return normalizeJsonConnection(connection);
    });
  };

  // Handle array format
  if (Array.isArray(data)) {
    return normalizeConnections(data);
  }

  // Handle native multi-database export package format.
  if (Array.isArray(data?.databases)) {
    const connections: unknown[] = [];
    for (const database of data.databases) {
      if (
        !database ||
        typeof database !== "object" ||
        !Array.isArray(database.connections)
      ) {
        throw new Error("JSON import contains a malformed database");
      }
      if (
        connections.length + database.connections.length >
        MAX_IMPORT_CONNECTIONS
      ) {
        throw new Error("JSON connection count exceeds the safety limit");
      }
      connections.push(...database.connections);
    }
    return normalizeConnections(connections);
  }

  // Handle object with connections array
  if (data.connections && Array.isArray(data.connections)) {
    return normalizeConnections(data.connections);
  }

  throw new Error(
    "Invalid JSON format: expected array or object with connections array",
  );
};

/**
 * Main import function that auto-detects format
 */
export const importConnections = async (
  content: string,
  filename?: string,
  format?: ImportFormat,
): Promise<Connection[]> => {
  assertImportTextWithinLimit(content);
  const detectedFormat = format || detectImportFormat(content, filename);

  let imported: Connection[];
  switch (detectedFormat) {
    case "xml":
      imported = await importFromXML(content);
      break;
    case "mremoteng":
      imported = await importFromMRemoteNG(content);
      break;
    case "rdcman":
      imported = await importFromRDCMan(content);
      break;
    case "mobaxterm":
      imported = await importFromMobaXterm(content);
      break;
    case "putty":
      imported = await importFromPuTTY(content);
      break;
    case "termius":
      imported = await importFromTermius(content);
      break;
    case "royalts":
      imported = await importFromRoyalTS(content);
      break;
    case "securecrt":
      imported = await importFromSecureCRT(content);
      break;
    case "json":
      imported = await importFromJSON(content);
      break;
    case "ini":
      imported = await importFromINI(content);
      break;
    case "csv":
    default:
      imported = await importFromCSV(content);
      break;
  }
  if (imported.length > MAX_IMPORT_CONNECTIONS) {
    throw new Error(
      `Import contains more than ${MAX_IMPORT_CONNECTIONS} connections`,
    );
  }
  return imported;
};

/**
 * Get human-readable format name
 */
export const getFormatName = (format: ImportFormat): string => {
  const names: Record<ImportFormat, string> = {
    json: "JSON",
    xml: "XML",
    csv: "CSV",
    ini: "INI",
    mremoteng: "mRemoteNG",
    rdcman: "Remote Desktop Connection Manager",
    royalts: "Royal TS/TSX",
    mobaxterm: "MobaXterm",
    putty: "PuTTY",
    securecrt: "SecureCRT",
    termius: "Termius",
  };
  return names[format] || format;
};
