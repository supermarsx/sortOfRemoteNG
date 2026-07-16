import {
  isIntegrationConnectionProtocol,
  type BuiltInConnectionProtocol,
} from "../../types/connection/connection";

export const ADDITIONAL_AUDITED_PROTOCOLS = ["mac", "ipmi", "k8s"] as const;

export type AdditionalAuditedProtocol =
  (typeof ADDITIONAL_AUDITED_PROTOCOLS)[number];
export type AuditedProtocol =
  | BuiltInConnectionProtocol
  | AdditionalAuditedProtocol;

export type ProtocolAvailabilityClass =
  | "fully-interactive"
  | "external-native-handoff"
  | "management-only"
  | "genuinely-unsupported";

export type ProtocolSessionEntry =
  | "client-owned"
  | "legacy-generic-timer"
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

/**
 * Persisted provider and hardware identities that have no saved-connection
 * session host. They may back import metadata, typed hooks, or control-plane
 * commands, but must never appear as selectable direct-session protocols.
 */
export const BUILT_IN_MANAGEMENT_PROTOCOLS = [
  "gcp",
  "azure",
  "ibm-csp",
  "digital-ocean",
  "heroku",
  "scaleway",
  "linode",
  "ovhcloud",
  "ilo",
  "lenovo",
  "supermicro",
] as const satisfies readonly BuiltInConnectionProtocol[];

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
    testPath: "tests/rdp/RDPClient.test.tsx",
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
    testPath: "tests/protocol/AnyDeskClient.test.tsx",
    detail:
      "The app tracks only a launcher process it starts, or uses an untracked native URL handoff. Remote authentication and the framebuffer remain owned by AnyDesk.",
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
  postgresql: capability({
    label: "PostgreSQL",
    classification: "fully-interactive",
    sessionEntry: "client-owned",
    frontendPath: "src/components/protocol/PostgreSQLClient.tsx",
    backendPath: "src-tauri/crates/sorng-postgres",
    testPath: "src/hooks/protocol/usePostgreSQLClient.test.tsx",
    detail:
      "The native query workbench owns an isolated direct database session with explicit SQLx SSL modes and certificate paths. Proxy, VPN, SSH-hop, and tunnel-chain routes fail closed.",
  }),
  spice: capability({
    label: "SPICE",
    classification: "external-native-handoff",
    sessionEntry: "client-owned",
    frontendPath: "src/components/protocol/SpiceClient.tsx",
    backendPath: "src-tauri/crates/sorng-spice",
    testPath: "src/hooks/protocol/useSpiceClient.test.tsx",
    detail:
      "The saved session launches installed virt-viewer remote-viewer with an in-memory stdin connection file and monitors only the local process lifecycle. Authentication, framebuffer, and input remain in its native window.",
  }),
  xdmcp: capability({
    label: "XDMCP",
    classification: "external-native-handoff",
    sessionEntry: "client-owned",
    frontendPath: "src/components/protocol/XdmcpClient.tsx",
    backendPath: "src-tauri/crates/sorng-xdmcp",
    testPath: "src/hooks/protocol/useXdmcpClient.test.tsx",
    detail:
      "The saved session launches and monitors an installed local X server. XDMCP is unauthenticated and unencrypted, requires explicit acknowledgement, and never reports remote login or display readiness.",
  }),
  x2go: capability({
    label: "X2Go",
    classification: "external-native-handoff",
    sessionEntry: "client-owned",
    frontendPath: "src/components/protocol/X2goNativeClient.tsx",
    backendPath: "src-tauri/crates/sorng-x2go",
    testPath: "src/hooks/protocol/useX2goNativeSession.test.tsx",
    detail:
      "The saved session launches and monitors installed X2Go Client. Native prompts own passwords, passphrases, host trust, and MFA; the app does not claim remote authentication or an embedded framebuffer.",
  }),
  nx: capability({
    label: "NX / NoMachine",
    classification: "external-native-handoff",
    sessionEntry: "client-owned",
    frontendPath: "src/components/protocol/NxNativeClient.tsx",
    backendPath: "src-tauri/crates/sorng-nx",
    testPath: "src/hooks/protocol/useNxNativeSession.test.tsx",
    detail:
      "The saved session launches and monitors installed NoMachine Client. Native prompts own authentication, host trust, and MFA; the app does not claim remote authentication or an embedded framebuffer.",
  }),
  ftp: capability({
    label: "FTP",
    classification: "fully-interactive",
    sessionEntry: "client-owned",
    frontendPath: "src/components/protocol/FTPClient.tsx",
    backendPath: "src-tauri/crates/sorng-ftp",
    testPath: "src/hooks/protocol/useFTPSession.test.tsx",
    detail:
      "The native file browser owns a direct passive/EPSV FTP or FTPS session. Routed connections, active mode, queues, resume, and live transfer progress fail closed or remain unavailable.",
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
    classification: "fully-interactive",
    sessionEntry: "client-owned",
    frontendPath: "src/components/protocol/ScpClient.tsx",
    backendPath: "src-tauri/crates/sorng-scp",
    testPath: "src/hooks/protocol/useScpClient.test.tsx",
    detail:
      "The native file browser owns a direct SCP session with explicit host-key policy. Proxy/VPN/tunnel routes, agent auth, cancellation, live progress, resume, and remote mutation beyond mkdir/delete remain unavailable.",
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
    classification: "management-only",
    sessionEntry: "none",
    frontendPath: null,
    backendPath: "src-tauri/crates/sorng-gcp",
    testPath: null,
    detail:
      "Provider commands exist in full builds, but no saved-connection management panel or direct session route is registered.",
  }),
  azure: capability({
    label: "Azure",
    classification: "management-only",
    sessionEntry: "none",
    frontendPath: null,
    backendPath: "src-tauri/crates/sorng-azure",
    testPath: null,
    detail:
      "Provider commands exist in full builds, but no saved-connection management panel or direct session route is registered.",
  }),
  "ibm-csp": capability({
    label: "IBM Cloud",
    classification: "management-only",
    sessionEntry: "none",
    frontendPath: null,
    backendPath: null,
    testPath: null,
    detail:
      "This is a persisted management identity only; no saved-connection panel or direct session runtime is registered.",
  }),
  "digital-ocean": capability({
    label: "DigitalOcean",
    classification: "management-only",
    sessionEntry: "none",
    frontendPath: null,
    backendPath: null,
    testPath: null,
    detail:
      "This is a persisted management identity only; no saved-connection panel or direct session runtime is registered.",
  }),
  heroku: capability({
    label: "Heroku",
    classification: "management-only",
    sessionEntry: "none",
    frontendPath: null,
    backendPath: null,
    testPath: null,
    detail:
      "This is a persisted management identity only; no saved-connection panel or direct session runtime is registered.",
  }),
  scaleway: capability({
    label: "Scaleway",
    classification: "management-only",
    sessionEntry: "none",
    frontendPath: null,
    backendPath: null,
    testPath: null,
    detail:
      "This is a persisted management identity only; no saved-connection panel or direct session runtime is registered.",
  }),
  linode: capability({
    label: "Linode",
    classification: "management-only",
    sessionEntry: "none",
    frontendPath: null,
    backendPath: null,
    testPath: null,
    detail:
      "This is a persisted management identity only; no saved-connection panel or direct session runtime is registered.",
  }),
  ovhcloud: capability({
    label: "OVHcloud",
    classification: "management-only",
    sessionEntry: "none",
    frontendPath: null,
    backendPath: null,
    testPath: null,
    detail:
      "This is a persisted management identity only; no saved-connection panel or direct session runtime is registered.",
  }),
  ilo: capability({
    label: "HP iLO",
    classification: "management-only",
    sessionEntry: "none",
    frontendPath: "src/hooks/hardware/useIlo.ts",
    backendPath: "src-tauri/crates/sorng-ilo",
    testPath: null,
    detail:
      "Backend commands and a typed hook exist, but no saved-connection panel or direct session route is registered.",
  }),
  lenovo: capability({
    label: "Lenovo XCC/IMM",
    classification: "management-only",
    sessionEntry: "none",
    frontendPath: "src/hooks/hardware/useLenovo.ts",
    backendPath: "src-tauri/crates/sorng-lenovo",
    testPath: null,
    detail:
      "Backend commands and a typed hook exist, but no saved-connection panel or direct session route is registered.",
  }),
  supermicro: capability({
    label: "Supermicro BMC",
    classification: "management-only",
    sessionEntry: "none",
    frontendPath: "src/hooks/hardware/useSupermicro.ts",
    backendPath: "src-tauri/crates/sorng-supermicro",
    testPath: null,
    detail:
      "Backend commands and a typed hook exist, but no saved-connection panel or direct session route is registered.",
  }),
} satisfies Record<BuiltInConnectionProtocol, ProtocolAvailability>;

export const ADDITIONAL_PROTOCOL_AVAILABILITY = {
  mac: capability({
    label: "Linux MAC management",
    classification: "management-only",
    sessionEntry: "none",
    frontendPath: "src/hooks/protocol/useMacClient.ts",
    backendPath: "src-tauri/crates/sorng-mac",
    testPath: null,
    detail:
      "SELinux/AppArmor operations are management APIs; no saved direct-session route is registered.",
  }),
  ipmi: capability({
    label: "IPMI",
    classification: "management-only",
    sessionEntry: "none",
    frontendPath: "src/hooks/protocol/useIPMIClient.ts",
    backendPath: "src-tauri/crates/sorng-ipmi",
    testPath: null,
    detail:
      "IPMI exposes BMC management operations; no saved direct-session route is registered.",
  }),
  k8s: capability({
    label: "Kubernetes",
    classification: "management-only",
    sessionEntry: "none",
    frontendPath: null,
    backendPath: "src-tauri/crates/sorng-k8s",
    testPath: null,
    detail:
      "Kubernetes backend commands exist, but no saved direct-session route is registered.",
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
  if (availability.classification === "management-only") {
    return `${availability.label} is management-only and has no registered interactive saved-connection route. ${availability.detail}`;
  }
  if (availability.classification === "genuinely-unsupported") {
    return `${availability.label} does not have a wired direct session runtime. ${availability.detail}`;
  }
  return null;
}
