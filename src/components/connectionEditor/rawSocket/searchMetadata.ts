import type {
  ConnectionEditorProtocolSubtabId,
  ConnectionEditorSearchDescriptor,
  ConnectionEditorSearchFieldDescriptor,
} from "../../connection/editor/editorRegistry";
import { RAW_SOCKET_PROTOCOL_ALIASES } from "../../../types/protocols/rawSocket";

export type RawSocketEditorSectionId =
  | "connection"
  | "data"
  | "tls"
  | "network-path"
  | "advanced";

export interface RawSocketEditorSectionMetadata {
  id: RawSocketEditorSectionId;
  label: string;
  description: string;
  protocolSubtabId: ConnectionEditorProtocolSubtabId;
}

export const RAW_SOCKET_EDITOR_SECTIONS = [
  {
    id: "connection",
    label: "Connection",
    description: "TCP or UDP transport, address family, and local binding.",
    protocolSubtabId: "connection",
  },
  {
    id: "data",
    label: "Data",
    description: "Payload encodings, line endings, and TCP message framing.",
    protocolSubtabId: "terminal",
  },
  {
    id: "tls",
    label: "TLS",
    description: "Direct TLS, manual STARTTLS, and certificate trust policy.",
    protocolSubtabId: "security",
  },
  {
    id: "network-path",
    label: "Network Path",
    description: "Runtime capability summary for direct and routed sockets.",
    protocolSubtabId: "network-path",
  },
  {
    id: "advanced",
    label: "Advanced",
    description: "Timeouts, TCP options, queues, replay, and payload limits.",
    protocolSubtabId: "advanced",
  },
] as const satisfies readonly RawSocketEditorSectionMetadata[];

const protocols = [...RAW_SOCKET_PROTOCOL_ALIASES];

export const RAW_SOCKET_EDITOR_SEARCH_FIELDS = [
  {
    id: "raw-socket-transport",
    label: "Transport",
    keywords: ["raw socket", "tcp", "udp", "netcat", "application payload"],
    copy: [
      "Application payload client",
      "Does not inject packets or craft IP headers",
    ],
    optionText: ["TCP byte stream", "UDP datagrams"],
    valuePaths: ["rawSocketSettings.connection.transport"],
    focusId: "raw-socket-transport",
    protocols,
    protocolSubtabId: "connection",
  },
  {
    id: "raw-socket-address-family",
    label: "Address family",
    keywords: ["dns", "ipv4", "ipv6", "fallback"],
    optionText: [
      "Automatic",
      "Prefer IPv4",
      "Prefer IPv6",
      "IPv4 only",
      "IPv6 only",
    ],
    valuePaths: ["rawSocketSettings.connection.addressFamily"],
    focusId: "raw-socket-address-family",
    protocols,
    protocolSubtabId: "connection",
  },
  {
    id: "raw-socket-local-bind-address",
    label: "Local bind address",
    keywords: ["source interface", "source ip", "bind"],
    valuePaths: ["rawSocketSettings.connection.localBindAddress"],
    focusId: "raw-socket-local-bind-address",
    protocols,
    protocolSubtabId: "connection",
  },
  {
    id: "raw-socket-local-bind-port",
    label: "Local bind port",
    keywords: ["source port", "ephemeral", "bind"],
    valuePaths: ["rawSocketSettings.connection.localBindPort"],
    focusId: "raw-socket-local-bind-port",
    protocols,
    protocolSubtabId: "connection",
  },
  {
    id: "raw-socket-input-encoding",
    label: "Composer input format",
    keywords: ["text", "utf-8", "hex", "base64", "binary"],
    optionText: ["UTF-8 text", "Hex bytes", "Base64"],
    valuePaths: ["rawSocketSettings.data.inputEncoding"],
    focusId: "raw-socket-input-encoding",
    protocols,
    protocolSubtabId: "terminal",
  },
  {
    id: "raw-socket-display-encoding",
    label: "Transcript display format",
    keywords: ["receive", "render", "text", "hex", "base64"],
    optionText: ["UTF-8 text", "Hex bytes", "Base64"],
    valuePaths: ["rawSocketSettings.data.displayEncoding"],
    focusId: "raw-socket-display-encoding",
    protocols,
    protocolSubtabId: "terminal",
  },
  {
    id: "raw-socket-line-ending",
    label: "Send line ending",
    keywords: ["newline", "lf", "crlf", "carriage return"],
    optionText: ["None", "LF", "CRLF"],
    valuePaths: ["rawSocketSettings.data.lineEnding"],
    focusId: "raw-socket-line-ending",
    protocols,
    protocolSubtabId: "terminal",
  },
  {
    id: "raw-socket-tcp-framing",
    label: "TCP framing",
    keywords: ["delimiter", "fixed length", "length prefix", "stream parser"],
    optionText: ["Read chunks", "Delimiter", "Fixed length", "Length prefix"],
    valuePaths: ["rawSocketSettings.data.tcpFraming"],
    focusId: "raw-socket-tcp-framing",
    protocols,
    protocolSubtabId: "terminal",
  },
  {
    id: "raw-socket-tls-mode",
    label: "TLS mode",
    keywords: ["encryption", "direct tls", "starttls", "dtls"],
    copy: ["DTLS is not supported", "TLS and STARTTLS are TCP-only"],
    optionText: ["Disabled", "Direct TLS", "Manual STARTTLS"],
    valuePaths: ["rawSocketSettings.tls.mode"],
    focusId: "raw-socket-tls-mode",
    protocols,
    protocolSubtabId: "security",
  },
  {
    id: "raw-socket-tls-server-name",
    label: "TLS server name",
    keywords: ["sni", "certificate hostname"],
    valuePaths: ["rawSocketSettings.tls.serverName"],
    focusId: "raw-socket-tls-server-name",
    protocols,
    protocolSubtabId: "security",
  },
  {
    id: "raw-socket-trust-policy",
    label: "Certificate trust policy",
    keywords: ["system roots", "tofu", "trust on first use", "always trust"],
    optionText: ["System trust store", "Trust on first use", "Always trust"],
    valuePaths: ["rawSocketSettings.tls.trustPolicy"],
    focusId: "raw-socket-trust-policy",
    protocols,
    protocolSubtabId: "security",
  },
  {
    id: "raw-socket-network-path",
    label: "Network Path capability",
    keywords: [
      "proxy",
      "http connect",
      "socks4",
      "socks5",
      "ssh jump",
      "fail closed",
    ],
    copy: [
      "Direct TCP and UDP are supported",
      "Unsupported routes fail closed instead of bypassing the configured path",
    ],
    focusId: "raw-socket-network-path",
    protocols,
    protocolSubtabId: "network-path",
  },
  {
    id: "raw-socket-timeouts",
    label: "Socket timeouts",
    keywords: ["connect timeout", "write timeout", "idle timeout"],
    valuePaths: [
      "rawSocketSettings.advanced.connectTimeoutMs",
      "rawSocketSettings.advanced.writeTimeoutMs",
      "rawSocketSettings.advanced.idleTimeoutMs",
    ],
    focusId: "raw-socket-connect-timeout",
    protocols,
    protocolSubtabId: "advanced",
  },
  {
    id: "raw-socket-tcp-options",
    label: "TCP socket options",
    keywords: ["nodelay", "nagle", "keepalive", "half close"],
    valuePaths: [
      "rawSocketSettings.advanced.tcpNoDelay",
      "rawSocketSettings.advanced.tcpKeepaliveMs",
    ],
    focusId: "raw-socket-tcp-no-delay",
    protocols,
    protocolSubtabId: "advanced",
  },
  {
    id: "raw-socket-resource-limits",
    label: "Resource limits",
    keywords: ["queue", "replay", "transcript", "buffer", "payload limit"],
    valuePaths: [
      "rawSocketSettings.advanced.commandQueueCapacity",
      "rawSocketSettings.advanced.replayFrames",
      "rawSocketSettings.advanced.replayBytes",
      "rawSocketSettings.advanced.readChunkBytes",
      "rawSocketSettings.advanced.maxSendBytes",
    ],
    focusId: "raw-socket-command-queue",
    protocols,
    protocolSubtabId: "advanced",
  },
] as const satisfies readonly ConnectionEditorSearchFieldDescriptor[];

export const RAW_SOCKET_CONNECTION_EDITOR_SEARCH_DESCRIPTOR = {
  id: "raw-socket-options",
  tabId: "protocol",
  label: "Raw Socket settings",
  keywords: [
    "raw socket",
    "raw tcp",
    "raw udp",
    "netcat",
    "application payload",
  ],
  copy: [
    "Binary-safe TCP and UDP client settings.",
    "Unsupported configured routes fail closed.",
  ],
  fields: RAW_SOCKET_EDITOR_SEARCH_FIELDS,
  connectionOnly: true,
} as const satisfies ConnectionEditorSearchDescriptor;
