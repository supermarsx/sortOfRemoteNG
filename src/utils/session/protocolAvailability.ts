import {
  isIntegrationConnectionProtocol,
  type BuiltInConnectionProtocol,
} from "../../types/connection/connection";

export const ADDITIONAL_AUDITED_PROTOCOLS = [
  "spice",
  "x2go",
  "nx",
  "xdmcp",
  "mac",
  "ipmi",
  "postgresql",
  "k8s",
] as const;

export type AdditionalAuditedProtocol =
  (typeof ADDITIONAL_AUDITED_PROTOCOLS)[number];
export type AuditedProtocol =
  | BuiltInConnectionProtocol
  | AdditionalAuditedProtocol;

export type ProtocolAvailabilityClass =
  | "fully-interactive"
  | "external-native-handoff"
  | "management-panel"
  | "genuinely-unsupported";

export type ProtocolSessionEntry =
  | "client-owned"
  | "legacy-generic-timer"
  | "management-host"
  | "none";

export interface ProtocolAvailability {
  label: string;
  classification: ProtocolAvailabilityClass;
  sessionEntry: ProtocolSessionEntry;
  frontendPath: string | null;
  backendPath: string | null;
  testPath: string | null;
  detail: string;
}

const capability = (value: ProtocolAvailability): ProtocolAvailability => value;

/**
 * Source-backed direct-session matrix. `satisfies` makes additions to the
 * persisted built-in protocol union a compile error until their runtime truth
 * is recorded here.
 */
export const BUILT_IN_PROTOCOL_AVAILABILITY = {
  rdp: capability({
    label: "RDP",
    classification: "fully-interactive",
    sessionEntry: "client-owned",
    frontendPath: "src/components/rdp/RDPClient.tsx",
    backendPath: "src-tauri/crates/sorng-rdp",
    testPath: "src/hooks/protocol/useSerialSession.test.tsx",
    detail: "The RDP client owns connect, render, input, detach, and close.",
  }),
  ssh: capability({
    label: "SSH",
    classification: "fully-interactive",
    sessionEntry: "client-owned",
    frontendPath: "src/components/ssh/WebTerminal.tsx",
    backendPath: "src-tauri/crates/sorng-ssh",
    testPath: "tests/session/SessionViewer.test.tsx",
    detail: "The web terminal owns the native SSH session and shell lifecycle.",
  }),
  ard: capability({
    label: "Apple Remote Desktop",
    classification: "fully-interactive",
    sessionEntry: "client-owned",
    frontendPath: "src/components/protocol/ArdClient.tsx",
    backendPath: "src-tauri/crates/sorng-ard",
    testPath: "src/components/protocol/ArdClient.test.tsx",
    detail:
      "The saved connection owns a native ARD/RFB framebuffer, input, reconnect, and Apple Screen Sharing handoff lifecycle.",
  }),
  serial: capability({
    label: "Serial",
    classification: "fully-interactive",
    sessionEntry: "client-owned",
    frontendPath: "src/components/protocol/SerialClient.tsx",
    backendPath: "src-tauri/crates/sorng-serial",
    testPath: "tests/session/SessionViewer.test.tsx",
    detail:
      "The terminal owns native port enumeration, connect, byte streaming, line controls, reconnect status, and disconnect.",
  }),
  vnc: capability({
    label: "VNC",
    classification: "fully-interactive",
    sessionEntry: "client-owned",
    frontendPath: "src/components/protocol/VNCClient.tsx",
    backendPath: null,
    testPath: "tests/session/SessionViewer.test.tsx",
    detail:
      "The noVNC client is interactive for WebSocket-capable VNC endpoints; it does not create a native TCP-to-WebSocket bridge.",
  }),
  anydesk: capability({
    label: "AnyDesk",
    classification: "external-native-handoff",
    sessionEntry: "client-owned",
    frontendPath: "src/components/protocol/AnyDeskClient.tsx",
    backendPath: "src-tauri/crates/sorng-remote-mgmt/src/anydesk.rs",
    testPath: "src/hooks/protocol/useAnyDeskClient.test.ts",
    detail:
      "The app launches or hands off to the installed AnyDesk client and does not embed its remote framebuffer.",
  }),
  http: capability({
    label: "HTTP",
    classification: "fully-interactive",
    sessionEntry: "client-owned",
    frontendPath: "src/components/protocol/WebBrowser.tsx",
    backendPath: "src-tauri/crates/sorng-protocols/src/http.rs",
    testPath: "src/hooks/protocol/useHTTPViewer.test.ts",
    detail: "The embedded browser owns its proxy and navigation lifecycle.",
  }),
  https: capability({
    label: "HTTPS",
    classification: "fully-interactive",
    sessionEntry: "client-owned",
    frontendPath: "src/components/protocol/WebBrowser.tsx",
    backendPath: "src-tauri/crates/sorng-protocols/src/http.rs",
    testPath: "src/hooks/protocol/useHTTPViewer.test.ts",
    detail: "The embedded browser owns HTTPS trust and navigation lifecycle.",
  }),
  telnet: capability({
    label: "Telnet",
    classification: "fully-interactive",
    sessionEntry: "client-owned",
    frontendPath: "src/components/protocol/TelnetClient.tsx",
    backendPath: "src-tauri/crates/sorng-telnet",
    testPath: "src/hooks/protocol/useTelnetSession.test.tsx",
    detail:
      "The terminal uses the registered native Telnet service and events.",
  }),
  raw: capability({
    label: "Raw Socket",
    classification: "fully-interactive",
    sessionEntry: "client-owned",
    frontendPath: "src/components/protocol/RawSocketClient.tsx",
    backendPath: "src-tauri/crates/sorng-protocols/src/raw_socket",
    testPath: "src/hooks/protocol/useRawSocketSession.test.tsx",
    detail: "The binary-safe TCP/UDP payload client owns a native session.",
  }),
  rlogin: capability({
    label: "RLogin",
    classification: "fully-interactive",
    sessionEntry: "client-owned",
    frontendPath: "src/components/protocol/RloginClient.tsx",
    backendPath: "src-tauri/crates/sorng-protocols/src/rlogin",
    testPath: "src/hooks/protocol/useRloginSession.test.tsx",
    detail: "The RFC 1282 client owns handshake, terminal, replay, and resize.",
  }),
  mysql: capability({
    label: "MySQL",
    classification: "fully-interactive",
    sessionEntry: "client-owned",
    frontendPath: "src/components/protocol/MySQLClient.tsx",
    backendPath: "src-tauri/crates/sorng-protocols/src/db.rs",
    testPath: "tests/protocol/useMySQLClient.test.ts",
    detail:
      "The query workbench connects from the saved connection before loading schemas; the backend currently exposes one process-wide database connection.",
  }),
  ftp: capability({
    label: "FTP",
    classification: "genuinely-unsupported",
    sessionEntry: "none",
    frontendPath: null,
    backendPath: "src-tauri/crates/sorng-ftp",
    testPath: "tests/session/useSessionManagerSettings.test.tsx",
    detail: "There is no direct interactive FTP tab; use SFTP.",
  }),
  sftp: capability({
    label: "SFTP",
    classification: "fully-interactive",
    sessionEntry: "client-owned",
    frontendPath: "src/components/protocol/SFTPClient.tsx",
    backendPath: "src-tauri/crates/sorng-sftp",
    testPath: "tests/protocol/FileTransferManager.test.tsx",
    detail:
      "The file browser owns native connect/disconnect and receives saved credentials, key data, host policy, paths, and timeouts.",
  }),
  scp: capability({
    label: "SCP",
    classification: "genuinely-unsupported",
    sessionEntry: "none",
    frontendPath: null,
    backendPath: "src-tauri/crates/sorng-scp",
    testPath: "tests/session/useSessionManagerSettings.test.tsx",
    detail: "There is no direct interactive SCP tab; use SFTP.",
  }),
  winrm: capability({
    label: "PowerShell Remoting",
    classification: "fully-interactive",
    sessionEntry: "client-owned",
    frontendPath: "src/components/protocol/PowerShellSessionViewer.tsx",
    backendPath: "src-tauri/crates/sorng-powershell",
    testPath: "src/hooks/protocol/usePowerShellSession.test.tsx",
    detail:
      "Persistent PSRP sessions support SSH and WSMan with truthful capability gates.",
  }),
  rustdesk: capability({
    label: "RustDesk",
    classification: "external-native-handoff",
    sessionEntry: "client-owned",
    frontendPath: "src/components/protocol/RustDeskClient.tsx",
    backendPath: "src-tauri/crates/sorng-rustdesk",
    testPath: "tests/session/SessionViewer.test.tsx",
    detail:
      "The app launches and verifies an installed RustDesk process using the saved remote ID and credential; it is an external-client handoff, not an embedded framebuffer.",
  }),
  smb: capability({
    label: "SMB",
    classification: "fully-interactive",
    sessionEntry: "client-owned",
    frontendPath: "src/components/protocol/SMBClient.tsx",
    backendPath: "src-tauri/crates/sorng-smb",
    testPath: "tests/protocol/useSMBClient.test.ts",
    detail:
      "The saved connection opens a native SMB session and routes to the share and file browser.",
  }),
  gcp: capability({
    label: "Google Cloud",
    classification: "management-panel",
    sessionEntry: "management-host",
    frontendPath: null,
    backendPath: "src-tauri/crates/sorng-gcp",
    testPath: null,
    detail:
      "Use the provider management surface rather than a generic session tab.",
  }),
  azure: capability({
    label: "Azure",
    classification: "management-panel",
    sessionEntry: "management-host",
    frontendPath: null,
    backendPath: "src-tauri/crates/sorng-azure",
    testPath: null,
    detail:
      "Use the provider management surface rather than a generic session tab.",
  }),
  "ibm-csp": capability({
    label: "IBM Cloud",
    classification: "management-panel",
    sessionEntry: "management-host",
    frontendPath: null,
    backendPath: null,
    testPath: null,
    detail: "No direct interactive IBM Cloud session is registered.",
  }),
  "digital-ocean": capability({
    label: "DigitalOcean",
    classification: "management-panel",
    sessionEntry: "management-host",
    frontendPath: null,
    backendPath: null,
    testPath: null,
    detail: "No direct interactive DigitalOcean session is registered.",
  }),
  heroku: capability({
    label: "Heroku",
    classification: "management-panel",
    sessionEntry: "management-host",
    frontendPath: null,
    backendPath: null,
    testPath: null,
    detail: "No direct interactive Heroku session is registered.",
  }),
  scaleway: capability({
    label: "Scaleway",
    classification: "management-panel",
    sessionEntry: "management-host",
    frontendPath: null,
    backendPath: null,
    testPath: null,
    detail: "No direct interactive Scaleway session is registered.",
  }),
  linode: capability({
    label: "Linode",
    classification: "management-panel",
    sessionEntry: "management-host",
    frontendPath: null,
    backendPath: null,
    testPath: null,
    detail: "No direct interactive Linode session is registered.",
  }),
  ovhcloud: capability({
    label: "OVHcloud",
    classification: "management-panel",
    sessionEntry: "management-host",
    frontendPath: null,
    backendPath: null,
    testPath: null,
    detail: "No direct interactive OVHcloud session is registered.",
  }),
  ilo: capability({
    label: "HP iLO",
    classification: "management-panel",
    sessionEntry: "management-host",
    frontendPath: "src/hooks/hardware/useIlo.ts",
    backendPath: "src-tauri/crates/sorng-ilo",
    testPath: null,
    detail: "iLO is a management panel, not a generic connected session.",
  }),
  lenovo: capability({
    label: "Lenovo XCC/IMM",
    classification: "management-panel",
    sessionEntry: "management-host",
    frontendPath: "src/hooks/hardware/useLenovo.ts",
    backendPath: "src-tauri/crates/sorng-lenovo",
    testPath: null,
    detail: "Lenovo BMC support is a management panel, not a generic session.",
  }),
  supermicro: capability({
    label: "Supermicro BMC",
    classification: "management-panel",
    sessionEntry: "management-host",
    frontendPath: "src/hooks/hardware/useSupermicro.ts",
    backendPath: "src-tauri/crates/sorng-supermicro",
    testPath: null,
    detail: "Supermicro support is a management panel, not a generic session.",
  }),
} satisfies Record<BuiltInConnectionProtocol, ProtocolAvailability>;

export const ADDITIONAL_PROTOCOL_AVAILABILITY = {
  spice: capability({
    label: "SPICE",
    classification: "genuinely-unsupported",
    sessionEntry: "none",
    frontendPath: "src/hooks/protocol/useSpiceClient.ts",
    backendPath: "src-tauri/crates/sorng-spice",
    testPath: null,
    detail: "A backend hook exists, but no saved-session viewer is registered.",
  }),
  x2go: capability({
    label: "X2Go",
    classification: "genuinely-unsupported",
    sessionEntry: "none",
    frontendPath: "src/hooks/protocol/useX2goClient.ts",
    backendPath: "src-tauri/crates/sorng-x2go",
    testPath: null,
    detail: "A backend hook exists, but no saved-session viewer is registered.",
  }),
  nx: capability({
    label: "NX / NoMachine",
    classification: "genuinely-unsupported",
    sessionEntry: "none",
    frontendPath: "src/hooks/protocol/useNxClient.ts",
    backendPath: "src-tauri/crates/sorng-nx",
    testPath: null,
    detail: "A backend hook exists, but no saved-session viewer is registered.",
  }),
  xdmcp: capability({
    label: "XDMCP",
    classification: "genuinely-unsupported",
    sessionEntry: "none",
    frontendPath: "src/hooks/protocol/useXdmcpClient.ts",
    backendPath: "src-tauri/crates/sorng-xdmcp",
    testPath: null,
    detail: "A backend hook exists, but no saved-session viewer is registered.",
  }),
  mac: capability({
    label: "Linux MAC management",
    classification: "management-panel",
    sessionEntry: "management-host",
    frontendPath: "src/hooks/protocol/useMacClient.ts",
    backendPath: "src-tauri/crates/sorng-mac",
    testPath: null,
    detail:
      "SELinux/AppArmor operations are management APIs, not a terminal protocol.",
  }),
  ipmi: capability({
    label: "IPMI",
    classification: "management-panel",
    sessionEntry: "management-host",
    frontendPath: "src/hooks/protocol/useIPMIClient.ts",
    backendPath: "src-tauri/crates/sorng-ipmi",
    testPath: null,
    detail:
      "IPMI exposes BMC management operations rather than a generic session viewer.",
  }),
  postgresql: capability({
    label: "PostgreSQL",
    classification: "genuinely-unsupported",
    sessionEntry: "none",
    frontendPath: null,
    backendPath: "src-tauri/crates/sorng-postgres",
    testPath: null,
    detail: "A connection template exists without a direct session viewer.",
  }),
  k8s: capability({
    label: "Kubernetes",
    classification: "management-panel",
    sessionEntry: "management-host",
    frontendPath: null,
    backendPath: "src-tauri/crates/sorng-k8s",
    testPath: null,
    detail:
      "Kubernetes is exposed through management/integration surfaces, not a generic session.",
  }),
} satisfies Record<AdditionalAuditedProtocol, ProtocolAvailability>;

export const PROTOCOL_AVAILABILITY: Readonly<
  Record<AuditedProtocol, ProtocolAvailability>
> = {
  ...BUILT_IN_PROTOCOL_AVAILABILITY,
  ...ADDITIONAL_PROTOCOL_AVAILABILITY,
};

const NORMALIZED_PROTOCOL_ALIASES: Readonly<Record<string, AuditedProtocol>> = {
  "raw-tcp": "raw",
  "raw-udp": "raw",
  powershell: "winrm",
  pwsh: "winrm",
  postgres: "postgresql",
  kubernetes: "k8s",
};

export function getProtocolAvailability(
  protocol: string,
): ProtocolAvailability | undefined {
  const normalized = protocol.trim().toLowerCase();
  const key =
    NORMALIZED_PROTOCOL_ALIASES[normalized] ?? (normalized as AuditedProtocol);
  return PROTOCOL_AVAILABILITY[key];
}

export function isClientOwnedProtocol(protocol: string): boolean {
  return getProtocolAvailability(protocol)?.sessionEntry === "client-owned";
}

export function usesLegacyGenericTimer(protocol: string): boolean {
  return (
    getProtocolAvailability(protocol)?.sessionEntry === "legacy-generic-timer"
  );
}

export function getDirectSessionUnavailableMessage(
  protocol: string,
): string | null {
  if (isIntegrationConnectionProtocol(protocol)) return null;
  const availability = getProtocolAvailability(protocol);
  if (!availability) {
    return `${protocol.toUpperCase()} has no registered frontend session runtime.`;
  }
  if (availability.classification === "management-panel") {
    return `${availability.label} is available through its management panel, not as a generic interactive session.`;
  }
  if (availability.classification === "genuinely-unsupported") {
    return `${availability.label} does not have a wired direct session runtime. ${availability.detail}`;
  }
  return null;
}
