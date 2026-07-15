import type { ConnectionEditorSearchDescriptor } from "../../connection/editor/editorRegistry";

export const RLOGIN_CONNECTION_SEARCH_DESCRIPTOR = {
  id: "rlogin-connection",
  tabId: "protocol",
  label: "RLogin connection",
  connectionOnly: true,
  keywords: ["rlogin", "RFC 1282", "port 513", "source port"],
  copy: [
    "Configure the RFC 1282 identity handshake and TCP endpoint.",
    "Reserved ports 512–1023 may require elevated privileges.",
  ],
  fields: [
    {
      id: "rlogin-local-username",
      focusId: "rlogin-local-username",
      label: "Local username",
      protocols: ["rlogin"],
      protocolSubtabId: "connection",
      valuePaths: ["rloginSettings.localUsername"],
      keywords: ["client user", "local user"],
    },
    {
      id: "rlogin-remote-username",
      focusId: "rlogin-remote-username",
      label: "Remote username",
      protocols: ["rlogin"],
      protocolSubtabId: "connection",
      valuePaths: ["rloginSettings.remoteUsername"],
      keywords: ["server user", "login name"],
    },
    {
      id: "rlogin-port",
      focusId: "rlogin-port",
      label: "RLogin target port",
      protocols: ["rlogin"],
      protocolSubtabId: "connection",
      copy: ["Default port 513", "Standard RLogin service port"],
    },
    {
      id: "rlogin-source-port-mode",
      focusId: "rlogin-source-port-mode",
      label: "Client source port",
      protocols: ["rlogin"],
      protocolSubtabId: "connection",
      valuePaths: ["rloginSettings.sourcePortMode"],
      optionText: [
        "Ephemeral recommended",
        "Reserved 512–1023",
        "Try reserved then ephemeral",
      ],
      copy: ["Classic trusted-host compatibility", "Elevated privileges"],
    },
    {
      id: "rlogin-reserved-port-range",
      focusId: "rlogin-reserved-port-start",
      label: "Reserved source-port range",
      protocols: ["rlogin"],
      protocolSubtabId: "connection",
      copy: ["Reserved range start", "Reserved range end", "512 to 1023"],
    },
  ],
} as const satisfies ConnectionEditorSearchDescriptor;

export const RLOGIN_TERMINAL_SEARCH_DESCRIPTOR = {
  id: "rlogin-terminal",
  tabId: "protocol",
  label: "RLogin terminal",
  connectionOnly: true,
  keywords: ["terminal", "encoding", "flow control", "escape"],
  copy: ["Remote echo", "Eight-bit transparent terminal stream"],
  fields: [
    {
      id: "rlogin-terminal-type",
      focusId: "rlogin-terminal-type",
      label: "Terminal type",
      protocols: ["rlogin"],
      protocolSubtabId: "terminal",
      valuePaths: ["rloginSettings.terminalType"],
      copy: ["xterm-256color", "TERM descriptor"],
    },
    {
      id: "rlogin-terminal-speed",
      focusId: "rlogin-terminal-speed",
      label: "Terminal speed",
      protocols: ["rlogin"],
      protocolSubtabId: "terminal",
      copy: ["Baud", "38400"],
    },
    {
      id: "rlogin-encoding",
      focusId: "rlogin-encoding",
      label: "Character encoding",
      protocols: ["rlogin"],
      protocolSubtabId: "terminal",
      valuePaths: ["rloginSettings.encoding"],
      optionText: ["UTF-8", "Windows-1252", "ISO-8859-1"],
    },
    {
      id: "rlogin-terminal-dimensions",
      focusId: "rlogin-initial-columns",
      label: "Initial terminal dimensions",
      protocols: ["rlogin"],
      protocolSubtabId: "terminal",
      copy: ["Columns", "Rows", "Window-size update"],
    },
    {
      id: "rlogin-local-flow-control",
      focusId: "rlogin-local-flow-control",
      label: "Local XON/XOFF flow control",
      protocols: ["rlogin"],
      protocolSubtabId: "terminal",
      copy: ["Ctrl-S pauses", "Ctrl-Q resumes", "Cooked mode", "Raw mode"],
    },
    {
      id: "rlogin-escape-enabled",
      focusId: "rlogin-escape-enabled",
      label: "Line-start escape commands",
      protocols: ["rlogin"],
      protocolSubtabId: "terminal",
      copy: ["~. disconnect", "Literal escape"],
    },
    {
      id: "rlogin-escape-character",
      focusId: "rlogin-escape-character",
      label: "Escape character",
      protocols: ["rlogin"],
      protocolSubtabId: "terminal",
      valuePaths: ["rloginSettings.escapeCharacter"],
      copy: ["Caret notation", "\\xNN"],
    },
  ],
} as const satisfies ConnectionEditorSearchDescriptor;

export const RLOGIN_NETWORK_PATH_SEARCH_DESCRIPTOR = {
  id: "rlogin-network-path",
  tabId: "protocol",
  label: "RLogin Network Path",
  connectionOnly: true,
  keywords: ["proxy", "VPN", "SSH jump", "strict chain", "route"],
  copy: [
    "Review whether the selected Network Path can deliver a strict RLogin TCP stream.",
    "Reserved client ports cannot be guaranteed through a Network Path.",
  ],
  fields: [
    {
      id: "rlogin-network-path-summary",
      focusId: "rlogin-network-path-summary",
      label: "RLogin Network Path capability",
      protocols: ["rlogin"],
      protocolSubtabId: "network-path",
      copy: [
        "Direct TCP",
        "HTTP CONNECT",
        "HTTPS CONNECT",
        "SOCKS4",
        "SOCKS5",
        "VPN",
        "SSH jump",
        "Fail closed",
      ],
    },
  ],
} as const satisfies ConnectionEditorSearchDescriptor;

export const RLOGIN_SECURITY_SEARCH_DESCRIPTOR = {
  id: "rlogin-security",
  tabId: "protocol",
  label: "RLogin security",
  connectionOnly: true,
  keywords: ["plaintext", "legacy", "risk", "acknowledgement"],
  copy: [
    "Usernames and terminal traffic are sent in plaintext.",
    "No encryption, integrity protection, or secure server authentication.",
    "No password automation.",
  ],
  fields: [
    {
      id: "rlogin-plaintext-acknowledgement",
      focusId: "rlogin-plaintext-acknowledgement",
      label: "Plaintext risk acknowledgement",
      protocols: ["rlogin"],
      protocolSubtabId: "security",
      copy: [
        "I understand and accept the plaintext risk for this connection",
        "Imported synchronized and cloned connections reset acknowledgement",
      ],
    },
  ],
} as const satisfies ConnectionEditorSearchDescriptor;

export const RLOGIN_ADVANCED_SEARCH_DESCRIPTOR = {
  id: "rlogin-advanced",
  tabId: "protocol",
  label: "RLogin advanced transport",
  connectionOnly: true,
  keywords: ["timeout", "TCP", "keepalive", "no-delay"],
  copy: ["Operating-system TCP keepalive", "No application keepalive bytes"],
  fields: [
    {
      id: "rlogin-connect-timeout",
      focusId: "rlogin-connect-timeout",
      label: "Connect timeout",
      protocols: ["rlogin"],
      protocolSubtabId: "advanced",
    },
    {
      id: "rlogin-handshake-timeout",
      focusId: "rlogin-handshake-timeout",
      label: "Handshake timeout",
      protocols: ["rlogin"],
      protocolSubtabId: "advanced",
    },
    {
      id: "rlogin-write-timeout",
      focusId: "rlogin-write-timeout",
      label: "Write timeout",
      protocols: ["rlogin"],
      protocolSubtabId: "advanced",
    },
    {
      id: "rlogin-idle-timeout",
      focusId: "rlogin-idle-timeout",
      label: "Idle read timeout",
      protocols: ["rlogin"],
      protocolSubtabId: "advanced",
    },
    {
      id: "rlogin-tcp-no-delay",
      focusId: "rlogin-tcp-no-delay",
      label: "TCP no-delay",
      protocols: ["rlogin"],
      protocolSubtabId: "advanced",
    },
    {
      id: "rlogin-tcp-keepalive",
      focusId: "rlogin-tcp-keepalive",
      label: "TCP keepalive",
      protocols: ["rlogin"],
      protocolSubtabId: "advanced",
    },
    {
      id: "rlogin-tcp-keepalive-seconds",
      focusId: "rlogin-tcp-keepalive-seconds",
      label: "TCP keepalive interval",
      protocols: ["rlogin"],
      protocolSubtabId: "advanced",
    },
  ],
} as const satisfies ConnectionEditorSearchDescriptor;

export const RLOGIN_CONNECTION_EDITOR_SEARCH_DESCRIPTORS = [
  RLOGIN_CONNECTION_SEARCH_DESCRIPTOR,
  RLOGIN_TERMINAL_SEARCH_DESCRIPTOR,
  RLOGIN_NETWORK_PATH_SEARCH_DESCRIPTOR,
  RLOGIN_SECURITY_SEARCH_DESCRIPTOR,
  RLOGIN_ADVANCED_SEARCH_DESCRIPTOR,
] as const satisfies readonly ConnectionEditorSearchDescriptor[];
