import {
  Cloud,
  FileText,
  Settings2,
  Tag,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { RAW_SOCKET_CONNECTION_EDITOR_SEARCH_DESCRIPTOR } from "../../connectionEditor/rawSocket/searchMetadata";
import { RLOGIN_CONNECTION_EDITOR_SEARCH_DESCRIPTORS } from "../../connectionEditor/rloginOptions/searchMetadata";
import { POWERSHELL_REMOTING_CONNECTION_EDITOR_SEARCH_DESCRIPTOR } from "../../connectionEditor/powerShellRemoting/searchMetadata";

export type ConnectionEditorTabId =
  | "general"
  | "protocol"
  | "behavior"
  | "organize"
  | "notes";

export type ConnectionEditorExpandableSectionId = "advanced";

export type ConnectionEditorProtocolSubtabId =
  | "connection"
  | "authentication"
  | "security"
  | "display-input"
  | "resources"
  | "network-path"
  | "network"
  | "advanced"
  | "provider"
  | "terminal"
  | "recovery";

export interface ConnectionEditorTabDescriptor {
  id: ConnectionEditorTabId;
  label: string;
  icon: LucideIcon;
  connectionOnly?: boolean;
}

export interface ConnectionEditorSearchFieldDescriptor {
  id: string;
  label: string;
  keywords?: readonly string[];
  copy?: readonly string[];
  optionText?: readonly string[];
  valuePaths?: readonly string[];
  focusId?: string;
  connectionOnly?: boolean;
  groupOnly?: boolean;
  protocols?: readonly string[];
  protocolPrefixes?: readonly string[];
  excludedProtocols?: readonly string[];
  protocolSubtabId?: ConnectionEditorProtocolSubtabId;
  visibleWhen?: (formData: Readonly<Record<string, unknown>>) => boolean;
}

export interface ConnectionEditorSearchDescriptor {
  id: string;
  tabId: ConnectionEditorTabId;
  label: string;
  keywords: readonly string[];
  copy?: readonly string[];
  fields: readonly ConnectionEditorSearchFieldDescriptor[];
  dynamicFields?: (
    formData: Readonly<Record<string, unknown>>,
  ) => readonly ConnectionEditorSearchFieldDescriptor[];
  connectionOnly?: boolean;
  expandableSectionId?: ConnectionEditorExpandableSectionId;
}

export interface ConnectionEditorSearchNavigationHandlers {
  activateTab: (tabId: ConnectionEditorTabId) => void;
  activateProtocolSubtab?: (subtabId: ConnectionEditorProtocolSubtabId) => void;
  expandSection?: (sectionId: ConnectionEditorExpandableSectionId) => void;
  focusField?: (
    fieldId: string,
    sectionId: string,
    fieldLabel?: string,
  ) => void;
}

export const CONNECTION_EDITOR_TABS = [
  { id: "general", label: "Basics", icon: Settings2 },
  { id: "protocol", label: "Protocol", icon: Cloud, connectionOnly: true },
  { id: "behavior", label: "Behavior", icon: Zap, connectionOnly: true },
  { id: "organize", label: "Organize", icon: Tag },
  { id: "notes", label: "Notes", icon: FileText },
] as const satisfies readonly ConnectionEditorTabDescriptor[];

type SearchFormData = Readonly<Record<string, unknown>>;

export const PROTOCOL_SEARCH_FIELD_SUBTABS: Readonly<
  Record<string, ConnectionEditorProtocolSubtabId>
> = {
  "network-path": "network-path",
  "ssh-username": "authentication",
  "ssh-authentication": "authentication",
  "ssh-host-key-trust": "authentication",
  "ssh-known-hosts": "authentication",
  "ssh-password": "authentication",
  "ssh-private-key": "authentication",
  "ssh-connection-timing": "authentication",
  "http-authentication": "authentication",
  "http-basic-username": "authentication",
  "http-basic-password": "authentication",
  "http-realm": "authentication",
  "http-custom-headers": "authentication",
  "http-tls": "security",
  "http-trust-policy": "security",
  "http-auto-login": "advanced",
  "http-auto-login-selectors": "advanced",
  "http-bookmarks": "advanced",
  "rdp-target-os": "connection",
  "rdp-domain": "connection",
  "rdp-display": "display-input",
  "rdp-audio": "display-input",
  "rdp-input": "display-input",
  "rdp-devices": "resources",
  "rdp-performance": "resources",
  "rdp-security": "security",
  "rdp-gateway": "network",
  "rdp-tcp": "network",
  "rdp-hyper-v": "advanced",
  "rdp-negotiation": "advanced",
  "rdp-advanced": "advanced",
  "winrm-options": "network",
  "cloud-gcp": "provider",
  "cloud-azure": "provider",
  "cloud-digital-ocean": "provider",
  "two-factor": "recovery",
  "backup-codes": "recovery",
  "security-questions": "recovery",
  "recovery-information": "recovery",
};

export function getConnectionEditorProtocolSubtabId(
  field: ConnectionEditorSearchFieldDescriptor,
  formData: SearchFormData,
): ConnectionEditorProtocolSubtabId | undefined {
  if (field.protocolSubtabId) return field.protocolSubtabId;
  if (field.id === "winrm-options" && formData.protocol === "winrm") {
    return "connection";
  }
  return PROTOCOL_SEARCH_FIELD_SUBTABS[field.id];
}

const getExchangeEnvironment = (formData: SearchFormData): unknown =>
  (
    (formData.integration as Record<string, unknown> | undefined)
      ?.providerFields as Record<string, unknown> | undefined
  )?.environment;

const showsExchangeOnlineFields = (formData: SearchFormData): boolean =>
  getExchangeEnvironment(formData) !== "onPremises";

const showsExchangeOnPremisesFields = (formData: SearchFormData): boolean => {
  const environment = getExchangeEnvironment(formData);
  return environment === "onPremises" || environment === "hybrid";
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const behaviorValueField = ({
  id,
  label,
  path,
  focusId = "behavior-automation",
  copy,
  optionText,
}: {
  id: string;
  label: string;
  path?: string;
  focusId?: string;
  copy?: readonly string[];
  optionText?: readonly string[];
}): ConnectionEditorSearchFieldDescriptor => ({
  id,
  label,
  focusId,
  copy,
  optionText,
  valuePaths: path ? [path] : undefined,
});

const getBehaviorAutomationFields = (
  formData: SearchFormData,
): readonly ConnectionEditorSearchFieldDescriptor[] => {
  const automation = formData.behaviorAutomation;
  if (!isRecord(automation) || automation.version !== 1) return [];
  const rules = Array.isArray(automation.rules) ? automation.rules : [];
  const fields: ConnectionEditorSearchFieldDescriptor[] = [];

  rules.forEach((ruleValue, ruleIndex) => {
    if (!isRecord(ruleValue)) return;
    const ruleNumber = ruleIndex + 1;
    const ruleId =
      typeof ruleValue.id === "string" && ruleValue.id
        ? ruleValue.id
        : String(ruleNumber);
    const rulePath = `behaviorAutomation.rules.${ruleIndex}`;
    fields.push(
      behaviorValueField({
        id: `automation-rule-${ruleNumber}-name`,
        focusId: `behavior-rule-${ruleId}-name`,
        label: `Rule ${ruleNumber} name`,
        path: `${rulePath}.name`,
      }),
      behaviorValueField({
        id: `automation-rule-${ruleNumber}-event`,
        label: `Rule ${ruleNumber} event`,
        path: `${rulePath}.event`,
        optionText: [
          "Connected",
          "Disconnected",
          "Connection failed",
          "Reconnecting",
          "Reconnected",
          "Session closed",
          "Window focused",
          "Window blurred",
          "Window minimized",
          "Window restored",
          "Window close requested",
          "Window closed",
        ],
      }),
      behaviorValueField({
        id: `automation-rule-${ruleNumber}-reasons`,
        label: "Reasons (optional — none means every reason)",
        path: `${rulePath}.when.reasons`,
        optionText: [
          "User requested",
          "Network error",
          "Authentication failed",
          "Timeout",
          "Remote closed",
          "Application shutdown",
        ],
      }),
      behaviorValueField({
        id: `automation-rule-${ruleNumber}-window-kinds`,
        label: "Window kinds (optional — none means main and detached)",
        path: `${rulePath}.when.windowKinds`,
        optionText: ["Main window", "Detached windows"],
      }),
      behaviorValueField({
        id: `automation-rule-${ruleNumber}-delay`,
        label: `Rule ${ruleNumber} delay (ms)`,
        copy: ["Delay before actions (ms)"],
      }),
      behaviorValueField({
        id: `automation-rule-${ruleNumber}-cooldown`,
        label: `Rule ${ruleNumber} cooldown (ms)`,
        copy: ["Cooldown after execution (ms)"],
      }),
      behaviorValueField({
        id: `automation-rule-${ruleNumber}-once`,
        label: `Rule ${ruleNumber} once per session`,
        copy: ["Run once per session"],
      }),
      behaviorValueField({
        id: `automation-rule-${ruleNumber}-stop-on-error`,
        label: `Rule ${ruleNumber} stop on action error`,
        copy: ["Stop remaining actions after an error"],
      }),
    );

    const actions = Array.isArray(ruleValue.actions) ? ruleValue.actions : [];
    actions.forEach((actionValue, actionIndex) => {
      if (!isRecord(actionValue)) return;
      const actionNumber = actionIndex + 1;
      const actionPath = `${rulePath}.actions.${actionIndex}`;
      const prefix = `behavior-rule-${ruleNumber}-action-${actionNumber}`;
      fields.push(
        behaviorValueField({
          id: `automation-rule-${ruleNumber}-action-${actionNumber}-type`,
          label: `Action ${actionNumber} type`,
          path: `${actionPath}.type`,
          optionText: [
            "Show notification",
            "Write log entry",
            "Reconnect",
            "Run saved script",
            "Focus session and owning window",
            "Close session tab",
            "Set owning window state",
          ],
        }),
      );

      if (actionValue.type === "notify") {
        fields.push(
          behaviorValueField({
            id: `${prefix}-title`,
            focusId: `${prefix}-title`,
            label: `Action ${actionNumber} notification title`,
            path: `${actionPath}.title`,
          }),
          behaviorValueField({
            id: `${prefix}-level`,
            label: `Action ${actionNumber} notification level`,
            path: `${actionPath}.level`,
            optionText: ["Information", "Warning", "Error"],
          }),
          behaviorValueField({
            id: `${prefix}-message`,
            focusId: `${prefix}-message`,
            label: `Action ${actionNumber} notification message`,
            path: `${actionPath}.message`,
          }),
          behaviorValueField({
            id: `${prefix}-sound`,
            label: `Action ${actionNumber} notification sound`,
            path: `${actionPath}.sound`,
            optionText: ["Use global setting", "Sound on", "Silent"],
          }),
        );
      } else if (actionValue.type === "writeLog") {
        fields.push(
          behaviorValueField({
            id: `${prefix}-log-message`,
            focusId: `${prefix}-log-message`,
            label: `Action ${actionNumber} log message`,
            path: `${actionPath}.message`,
          }),
          behaviorValueField({
            id: `${prefix}-log-level`,
            label: `Action ${actionNumber} log level`,
            path: `${actionPath}.level`,
            optionText: ["Information", "Warning", "Error"],
          }),
        );
      } else if (actionValue.type === "reconnect") {
        fields.push(
          behaviorValueField({
            id: `${prefix}-reconnect-delay`,
            focusId: `${prefix}-reconnect-delay`,
            label: `Action ${actionNumber} reconnect delay (ms)`,
          }),
          behaviorValueField({
            id: `${prefix}-reconnect-attempts`,
            focusId: `${prefix}-reconnect-attempts`,
            label: `Action ${actionNumber} maximum attempts`,
            copy: ["0 prevents the action from starting a retry."],
          }),
          behaviorValueField({
            id: `${prefix}-reconnect-backoff`,
            label: `Action ${actionNumber} reconnect backoff`,
            path: `${actionPath}.backoff`,
            optionText: ["Fixed delay", "Exponential delay"],
          }),
        );
      } else if (actionValue.type === "runCustomScript") {
        fields.push(
          behaviorValueField({
            id: `${prefix}-script`,
            label: `Action ${actionNumber} saved script`,
            path: `${actionPath}.scriptId`,
            copy: ["Saved script", "Select a saved script"],
          }),
          behaviorValueField({
            id: `${prefix}-script-timeout`,
            focusId: `${prefix}-script-timeout`,
            label: `Action ${actionNumber} script timeout (ms)`,
          }),
        );
      } else if (actionValue.type === "focusSession") {
        fields.push(
          behaviorValueField({
            id: `${prefix}-restore-minimized`,
            label: `Action ${actionNumber} restore minimized window`,
            path: `${actionPath}.restoreIfMinimized`,
            copy: ["Restore the owning window if minimized"],
          }),
          behaviorValueField({
            id: `${prefix}-raise-window`,
            label: `Action ${actionNumber} raise owning window`,
            path: `${actionPath}.raiseWindow`,
            copy: ["Raise and focus the owning window"],
          }),
        );
      } else if (actionValue.type === "closeTab") {
        fields.push(
          behaviorValueField({
            id: `${prefix}-close-policy`,
            label: `Action ${actionNumber} close policy`,
            copy: [
              "Uses the existing close confirmation, disconnect, and cleanup policy.",
            ],
          }),
        );
      } else if (actionValue.type === "setOwningWindowState") {
        fields.push(
          behaviorValueField({
            id: `${prefix}-window-state`,
            label: `Action ${actionNumber} owning window state`,
            path: `${actionPath}.state`,
            optionText: ["Focused", "Minimized", "Restored"],
          }),
        );
      }
    });
  });

  return fields;
};

const nativeDisplayField = (
  protocol: "spice" | "xdmcp" | "x2go" | "nx",
  id: string,
  label: string,
  protocolSubtabId: ConnectionEditorProtocolSubtabId,
  options: Omit<
    ConnectionEditorSearchFieldDescriptor,
    "id" | "label" | "protocols" | "protocolSubtabId"
  > = {},
): ConnectionEditorSearchFieldDescriptor => ({
  id,
  label,
  protocols: [protocol],
  protocolSubtabId,
  ...options,
});

const NATIVE_DISPLAY_CONNECTION_EDITOR_FIELDS = [
  nativeDisplayField(
    "spice",
    "spice-proxy-uri",
    "SPICE HTTP CONNECT proxy URI",
    "connection",
    {
      keywords: ["proxy", "http connect", "dedicated spice proxy"],
      valuePaths: ["spiceProxyUri"],
    },
  ),
  nativeDisplayField(
    "spice",
    "spice-native-window",
    "Native SPICE viewer boundary",
    "connection",
    {
      keywords: [
        "remote-viewer",
        "virt-viewer",
        "external window",
        "fail closed",
      ],
      copy: [
        "Running local viewer process",
        "Remote authentication and display are not confirmed",
        "Generic proxy, VPN, SSH-hop, and tunnel-chain routes fail closed",
      ],
    },
  ),
  nativeDisplayField(
    "spice",
    "spice-ticket",
    "SPICE ticket",
    "authentication",
    {
      keywords: ["password", "credential", "stdin connection file"],
      copy: ["Never placed in process arguments or a persistent profile"],
    },
  ),
  nativeDisplayField(
    "spice",
    "spice-require-tls",
    "Require TLS SPICE transport",
    "security",
    {
      keywords: ["encryption", "tls", "secure"],
      valuePaths: ["spiceRequireTls"],
    },
  ),
  nativeDisplayField(
    "spice",
    "spice-tls-port-enabled",
    "Separate SPICE TLS port",
    "security",
    {
      keywords: ["tls-port", "remote-viewer"],
      valuePaths: ["spiceTlsPort"],
    },
  ),
  nativeDisplayField("spice", "spice-tls-port", "SPICE TLS port", "security", {
    valuePaths: ["spiceTlsPort"],
    visibleWhen: (formData) => formData.spiceTlsPort !== undefined,
  }),
  nativeDisplayField(
    "spice",
    "spice-ca-certificate",
    "SPICE CA certificate path",
    "security",
    {
      keywords: ["certificate", "trust", "ca"],
      valuePaths: ["spiceCaCertificatePath"],
      visibleWhen: (formData) => formData.spiceTlsPort !== undefined,
    },
  ),
  nativeDisplayField(
    "spice",
    "spice-host-subject",
    "Expected SPICE certificate subject",
    "security",
    {
      keywords: ["host-subject", "certificate name", "hostname verification"],
      valuePaths: ["spiceTlsHostSubject"],
      visibleWhen: (formData) => formData.spiceTlsPort !== undefined,
    },
  ),
  nativeDisplayField(
    "spice",
    "spice-verified-certificates",
    "Verified SPICE certificates",
    "security",
    {
      keywords: ["self-signed", "unverified", "certificate trust"],
      copy: [
        "Unverified SPICE certificates are intentionally unsupported",
        "Use system trust or provide the issuing CA certificate",
      ],
    },
  ),
  nativeDisplayField(
    "spice",
    "spice-fullscreen",
    "SPICE fullscreen",
    "display-input",
    {
      valuePaths: ["spiceFullscreen"],
    },
  ),
  nativeDisplayField(
    "spice",
    "spice-view-only",
    "SPICE view only",
    "display-input",
    {
      keywords: ["disable input", "keyboard", "pointer"],
      valuePaths: ["spiceViewOnly"],
    },
  ),
  nativeDisplayField(
    "spice",
    "spice-clipboard-boundary",
    "SPICE clipboard boundary",
    "display-input",
    {
      keywords: ["clipboard", "remote-viewer default"],
      copy: [
        "Disabling clipboard is not exposed because the native handoff cannot enforce it",
      ],
    },
  ),
  nativeDisplayField(
    "spice",
    "spice-audio",
    "SPICE audio playback",
    "resources",
    {
      valuePaths: ["spiceAudioPlayback"],
    },
  ),
  nativeDisplayField(
    "spice",
    "spice-usb-redirection",
    "SPICE USB redirection",
    "resources",
    {
      keywords: ["device redirection", "usb"],
      valuePaths: ["spiceUsbRedirection"],
    },
  ),
  nativeDisplayField(
    "spice",
    "spice-native-client",
    "remote-viewer executable path",
    "advanced",
    {
      keywords: ["virt-viewer", "binary", "installed client", "PATH"],
      valuePaths: ["spiceNativeClientPath"],
    },
  ),

  nativeDisplayField(
    "xdmcp",
    "xdmcp-query-type",
    "XDMCP query type",
    "connection",
    {
      optionText: ["Direct query", "Broadcast query", "Indirect chooser query"],
      valuePaths: ["xdmcpQueryType"],
    },
  ),
  nativeDisplayField(
    "xdmcp",
    "xdmcp-display-number",
    "XDMCP local display number",
    "connection",
    {
      keywords: ["X display", "display number"],
      valuePaths: ["xdmcpDisplayNumber"],
    },
  ),
  nativeDisplayField(
    "xdmcp",
    "xdmcp-insecure-warning",
    "XDMCP is unauthenticated and unencrypted",
    "security",
    {
      keywords: ["plaintext", "insecure transport", "trusted isolated network"],
      copy: [
        "Hosts on the path can observe or alter the login display and session traffic",
        "Proxy, VPN, SSH-hop, and tunnel-chain settings are rejected",
      ],
    },
  ),
  nativeDisplayField(
    "xdmcp",
    "xdmcp-insecure-acknowledgement",
    "Accept XDMCP transport risk",
    "security",
    {
      keywords: ["required acknowledgement", "unsafe"],
      valuePaths: ["xdmcpAcknowledgeInsecureTransport"],
    },
  ),
  nativeDisplayField(
    "xdmcp",
    "xdmcp-width",
    "XDMCP window width",
    "display-input",
    {
      valuePaths: ["xdmcpResolutionWidth"],
    },
  ),
  nativeDisplayField(
    "xdmcp",
    "xdmcp-height",
    "XDMCP window height",
    "display-input",
    {
      valuePaths: ["xdmcpResolutionHeight"],
    },
  ),
  nativeDisplayField(
    "xdmcp",
    "xdmcp-color-depth",
    "XDMCP color depth",
    "display-input",
    {
      keywords: ["24-bit", "native X server default"],
      copy: [
        "Alternative depth values are not exposed because they cannot be applied consistently",
      ],
    },
  ),
  nativeDisplayField(
    "xdmcp",
    "xdmcp-fullscreen",
    "XDMCP fullscreen",
    "display-input",
    {
      valuePaths: ["xdmcpFullscreen"],
    },
  ),
  nativeDisplayField(
    "xdmcp",
    "xdmcp-x-server-type",
    "Local X server",
    "advanced",
    {
      optionText: ["Platform default", "VcXsrv", "Xephyr", "Xming"],
      valuePaths: ["xdmcpXServerType"],
    },
  ),
  nativeDisplayField(
    "xdmcp",
    "xdmcp-x-server-path",
    "X server executable path",
    "advanced",
    {
      keywords: ["binary", "installed X server", "PATH"],
      valuePaths: ["xdmcpXServerPath"],
    },
  ),

  nativeDisplayField(
    "x2go",
    "x2go-session-type",
    "X2Go desktop or session type",
    "connection",
    {
      optionText: [
        "XFCE",
        "KDE",
        "GNOME",
        "LXDE",
        "LXQt",
        "MATE",
        "Cinnamon",
        "Unity",
        "Trinity",
        "Shadow",
        "RDP",
        "Custom desktop command",
        "Single application",
      ],
      valuePaths: ["x2goSessionType"],
    },
  ),
  nativeDisplayField(
    "x2go",
    "x2go-command",
    "X2Go remote command",
    "connection",
    {
      keywords: ["custom desktop", "single application"],
      valuePaths: ["x2goCommand"],
      visibleWhen: (formData) =>
        ["Custom", "Application"].includes(String(formData.x2goSessionType)),
    },
  ),
  nativeDisplayField(
    "x2go",
    "x2go-username",
    "X2Go username",
    "authentication",
    {
      valuePaths: ["username"],
    },
  ),
  nativeDisplayField(
    "x2go",
    "x2go-auth-mode",
    "X2Go SSH authentication",
    "authentication",
    {
      optionText: [
        "Native password prompt",
        "Private key or key path",
        "SSH agent",
        "GSSAPI / Kerberos",
      ],
      valuePaths: ["x2goAuthMode"],
    },
  ),
  nativeDisplayField(
    "x2go",
    "x2go-private-key",
    "X2Go private key or local key path",
    "authentication",
    {
      keywords: ["inline key", "ssh key"],
      visibleWhen: (formData) => formData.x2goAuthMode === "privateKey",
    },
  ),
  nativeDisplayField(
    "x2go",
    "x2go-fullscreen",
    "X2Go fullscreen",
    "display-input",
    {
      valuePaths: ["x2goFullscreen"],
    },
  ),
  nativeDisplayField(
    "x2go",
    "x2go-width",
    "X2Go window width",
    "display-input",
    {
      valuePaths: ["x2goWidth"],
      visibleWhen: (formData) => formData.x2goFullscreen !== true,
    },
  ),
  nativeDisplayField(
    "x2go",
    "x2go-height",
    "X2Go window height",
    "display-input",
    {
      valuePaths: ["x2goHeight"],
      visibleWhen: (formData) => formData.x2goFullscreen !== true,
    },
  ),
  nativeDisplayField(
    "x2go",
    "x2go-keyboard-layout",
    "X2Go keyboard layout",
    "display-input",
    {
      valuePaths: ["x2goKeyboardLayout"],
    },
  ),
  nativeDisplayField(
    "x2go",
    "x2go-keyboard-model",
    "X2Go keyboard model",
    "display-input",
    {
      valuePaths: ["x2goKeyboardModel"],
    },
  ),
  nativeDisplayField(
    "x2go",
    "x2go-clipboard",
    "X2Go clipboard direction",
    "display-input",
    {
      optionText: [
        "Both directions",
        "Client to server",
        "Server to client",
        "Disabled",
      ],
      valuePaths: ["x2goClipboard"],
    },
  ),
  nativeDisplayField(
    "x2go",
    "x2go-audio",
    "X2Go PulseAudio forwarding",
    "resources",
    {
      valuePaths: ["x2goAudioEnabled"],
    },
  ),
  nativeDisplayField(
    "x2go",
    "x2go-printing",
    "X2Go client-side printing",
    "resources",
    {
      valuePaths: ["x2goPrintingEnabled"],
    },
  ),
  nativeDisplayField(
    "x2go",
    "x2go-shared-folders",
    "X2Go shared local folders",
    "resources",
    {
      keywords: ["file sharing", "mount", "local path"],
      copy: ["One path per line", "Custom remote folder names are not exposed"],
      valuePaths: ["x2goSharedFolders"],
    },
  ),
  nativeDisplayField(
    "x2go",
    "x2go-compression",
    "X2Go link profile",
    "advanced",
    {
      optionText: ["Modem", "ISDN", "ADSL", "WAN", "LAN"],
      valuePaths: ["x2goCompression"],
    },
  ),
  nativeDisplayField("x2go", "x2go-dpi", "X2Go DPI", "advanced", {
    valuePaths: ["x2goDpi"],
  }),
  nativeDisplayField(
    "x2go",
    "x2go-rootless",
    "X2Go rootless window mode",
    "advanced",
    {
      valuePaths: ["x2goRootless"],
    },
  ),
  nativeDisplayField(
    "x2go",
    "x2go-published-applications",
    "X2Go published applications",
    "advanced",
    {
      valuePaths: ["x2goPublishedApplications"],
    },
  ),
  nativeDisplayField(
    "x2go",
    "x2go-native-client",
    "x2goclient executable path",
    "advanced",
    {
      keywords: ["installed client", "binary", "PATH"],
      valuePaths: ["x2goNativeClientPath"],
    },
  ),
  nativeDisplayField(
    "x2go",
    "x2go-native-window",
    "Native X2Go Client boundary",
    "advanced",
    {
      copy: [
        "Running local process only",
        "Native prompt owns password, passphrase, host trust, and MFA",
        "Remote authentication, pixels, and input are not confirmed",
        "App routes fail closed",
      ],
    },
  ),

  nativeDisplayField(
    "nx",
    "nx-connection-service",
    "NoMachine transport",
    "connection",
    {
      optionText: ["NX service (port 4000)", "NoMachine over SSH (port 22)"],
      valuePaths: ["nxConnectionService"],
    },
  ),
  nativeDisplayField(
    "nx",
    "nx-session-type",
    "NoMachine desktop or session type",
    "connection",
    {
      optionText: [
        "Default Unix desktop",
        "GNOME",
        "KDE",
        "XFCE",
        "Console session",
        "Physical desktop chooser",
        "Custom Unix command",
        "Single application",
      ],
      valuePaths: ["nxSessionType"],
    },
  ),
  nativeDisplayField(
    "nx",
    "nx-command",
    "NoMachine remote command",
    "connection",
    {
      keywords: ["custom unix", "single application"],
      valuePaths: ["nxCustomCommand"],
      visibleWhen: (formData) =>
        ["UnixCustom", "Application"].includes(String(formData.nxSessionType)),
    },
  ),
  nativeDisplayField(
    "nx",
    "nx-username",
    "NoMachine username",
    "authentication",
    {
      valuePaths: ["username"],
    },
  ),
  nativeDisplayField(
    "nx",
    "nx-private-key",
    "NoMachine private key or local key path",
    "authentication",
    {
      keywords: ["native password prompt", "ssh key", "inline key"],
      copy: [
        "Native Client owns password, key-passphrase, host-trust, and MFA prompts",
      ],
    },
  ),
  nativeDisplayField(
    "nx",
    "nx-fullscreen",
    "NoMachine fullscreen",
    "display-input",
    {
      valuePaths: ["nxFullscreen"],
    },
  ),
  nativeDisplayField(
    "nx",
    "nx-width",
    "NoMachine window width",
    "display-input",
    {
      valuePaths: ["nxWidth"],
      visibleWhen: (formData) => formData.nxFullscreen !== true,
    },
  ),
  nativeDisplayField(
    "nx",
    "nx-height",
    "NoMachine window height",
    "display-input",
    {
      valuePaths: ["nxHeight"],
      visibleWhen: (formData) => formData.nxFullscreen !== true,
    },
  ),
  nativeDisplayField(
    "nx",
    "nx-native-input",
    "NoMachine native input and clipboard boundary",
    "display-input",
    {
      keywords: ["keyboard", "pointer", "clipboard"],
      copy: [
        "Clipboard remains enabled",
        "Input is owned by the native NoMachine window",
      ],
    },
  ),
  nativeDisplayField("nx", "nx-audio", "NoMachine audio", "resources", {
    valuePaths: ["nxAudioEnabled"],
  }),
  nativeDisplayField(
    "nx",
    "nx-native-client",
    "nxplayer executable path",
    "advanced",
    {
      keywords: ["NoMachine Client", "binary", "PATH"],
      valuePaths: ["nxNativeClientPath"],
    },
  ),
  nativeDisplayField(
    "nx",
    "nx-native-window",
    "Native NoMachine Client boundary",
    "advanced",
    {
      copy: [
        "Running local process only",
        "Native prompt owns authentication, host trust, and MFA",
        "Remote authentication, pixels, and input are not confirmed",
        "App routes fail closed",
      ],
    },
  ),
] satisfies readonly ConnectionEditorSearchFieldDescriptor[];

export const CONNECTION_EDITOR_SEARCH_DESCRIPTORS = [
  {
    id: "general-basics",
    tabId: "general",
    label: "Basics",
    keywords: ["identity", "folder", "group", "favorite"],
    copy: ["Choose whether this item is a connection or folder."],
    fields: [
      {
        id: "isGroup",
        label: "Folder/Group",
        keywords: ["type"],
        optionText: ["Connection", "Folder", "Group"],
      },
      {
        id: "favorite",
        label: "Favorite",
        keywords: ["star"],
        connectionOnly: true,
      },
      {
        id: "name",
        label: "Connection Name",
        keywords: ["title", "folder name"],
        copy: ["Connection Name", "Folder Name", "Production Server"],
        valuePaths: ["name"],
      },
    ],
  },
  {
    id: "general-parent",
    tabId: "general",
    label: "Parent Folder",
    keywords: ["parent", "folder", "group", "root", "organize"],
    copy: ["Choose where this item appears in the folder hierarchy."],
    fields: [
      {
        id: "parent-folder",
        label: "Parent Folder",
        copy: ["Root (No parent)", "Search folders"],
      },
    ],
  },
  {
    id: "general-connection",
    tabId: "general",
    label: "Connection",
    keywords: ["protocol", "server", "host", "credentials", "integration"],
    copy: ["Server address and sign-in settings for this connection."],
    connectionOnly: true,
    fields: [
      {
        id: "protocol",
        label: "Protocol",
        keywords: ["connection type"],
        copy: ["Search protocols, clouds, integrations"],
        valuePaths: ["protocol"],
      },
      {
        id: "hostname",
        label: "Hostname / IP",
        keywords: ["host", "server"],
        copy: ["Server address"],
        excludedProtocols: ["rustdesk", "serial"],
        visibleWhen: (formData) =>
          !String(formData.protocol ?? "").startsWith("integration:"),
        valuePaths: ["hostname"],
      },
      {
        id: "port",
        label: "Port",
        excludedProtocols: ["rustdesk", "serial", "integration:exchange"],
        visibleWhen: (formData) =>
          !String(formData.protocol ?? "").startsWith("integration:"),
      },
      {
        id: "username",
        label: "Username",
        keywords: ["user", "account"],
        copy: [
          "Windows account name",
          "Account for WinRM Basic auth",
          "Username for authentication with the remote service",
        ],
        excludedProtocols: [
          "ssh",
          "raw",
          "rlogin",
          "ard",
          "sftp",
          "rustdesk",
          "serial",
          "postgresql",
          "spice",
          "xdmcp",
          "x2go",
          "nx",
          "integration:exchange",
        ],
        valuePaths: ["username", "integration.username"],
      },
      {
        id: "password",
        label: "Password",
        keywords: ["credential", "sign in"],
        copy: [
          "Windows account password",
          "Password for WinRM authentication",
          "Password for authentication with the remote service",
        ],
        excludedProtocols: [
          "ssh",
          "raw",
          "rlogin",
          "ard",
          "sftp",
          "rustdesk",
          "serial",
          "postgresql",
          "spice",
          "xdmcp",
          "x2go",
          "nx",
          "integration:exchange",
        ],
      },
      {
        id: "integration-instance-id",
        label: "Instance ID",
        protocolPrefixes: ["integration:"],
        valuePaths: ["integration.instanceId"],
      },
      {
        id: "integration-instance-name",
        label: "Instance Name",
        protocolPrefixes: ["integration:"],
        valuePaths: ["integration.instanceName"],
      },
      {
        id: "integration-host",
        focusId: "hostname",
        label: "Host",
        protocolPrefixes: ["integration:"],
        excludedProtocols: ["integration:exchange"],
        valuePaths: ["integration.host"],
      },
      {
        id: "integration-base-url",
        label: "Base URL",
        protocolPrefixes: ["integration:"],
        excludedProtocols: ["integration:exchange"],
        valuePaths: ["integration.baseUrl"],
      },
      {
        id: "integration-auth-token",
        label: "Auth Token",
        protocolPrefixes: ["integration:"],
        excludedProtocols: ["integration:exchange"],
        keywords: ["credential"],
      },
      {
        id: "integration-api-key",
        label: "API Key",
        protocolPrefixes: ["integration:"],
        excludedProtocols: ["integration:exchange"],
        keywords: ["credential"],
      },
      {
        id: "integration-tls-verify",
        label: "TLS Verify",
        protocolPrefixes: ["integration:"],
        excludedProtocols: ["integration:exchange"],
        optionText: ["Verify TLS certificates"],
      },
      {
        id: "integration-timeout",
        label: "Timeout (s)",
        protocolPrefixes: ["integration:"],
        excludedProtocols: ["integration:exchange"],
      },
      {
        id: "exchange-environment",
        label: "Environment",
        protocols: ["integration:exchange"],
        optionText: ["Exchange Online", "Exchange Server", "Hybrid"],
        valuePaths: ["integration.providerFields.environment"],
      },
      {
        id: "exchange-timeout",
        label: "Timeout (s)",
        protocols: ["integration:exchange"],
        valuePaths: ["integration.providerFields.timeoutSecs"],
      },
      {
        id: "exchange-tenant-id",
        label: "Tenant ID",
        protocols: ["integration:exchange"],
        visibleWhen: showsExchangeOnlineFields,
        valuePaths: ["integration.providerFields.tenantId"],
      },
      {
        id: "exchange-client-id",
        label: "Client ID",
        protocols: ["integration:exchange"],
        visibleWhen: showsExchangeOnlineFields,
        valuePaths: ["integration.providerFields.clientId"],
      },
      {
        id: "exchange-client-secret",
        label: "Client Secret",
        protocols: ["integration:exchange"],
        visibleWhen: showsExchangeOnlineFields,
      },
      {
        id: "exchange-online-username",
        label: "Online Username",
        protocols: ["integration:exchange"],
        visibleWhen: showsExchangeOnlineFields,
        valuePaths: ["integration.providerFields.onlineUsername"],
      },
      {
        id: "exchange-organization",
        label: "Organization",
        protocols: ["integration:exchange"],
        visibleWhen: showsExchangeOnlineFields,
        valuePaths: ["integration.providerFields.organization"],
      },
      {
        id: "exchange-server",
        label: "Server",
        protocols: ["integration:exchange"],
        visibleWhen: showsExchangeOnPremisesFields,
        valuePaths: ["integration.providerFields.server"],
      },
      {
        id: "exchange-onprem-username",
        label: "On-prem Username",
        protocols: ["integration:exchange"],
        visibleWhen: showsExchangeOnPremisesFields,
        valuePaths: ["integration.providerFields.onPremUsername"],
      },
      {
        id: "exchange-port",
        label: "Port",
        protocols: ["integration:exchange"],
        visibleWhen: showsExchangeOnPremisesFields,
        valuePaths: ["integration.providerFields.port"],
      },
      {
        id: "exchange-password",
        label: "Password",
        protocols: ["integration:exchange"],
        visibleWhen: showsExchangeOnPremisesFields,
      },
      {
        id: "exchange-auth-method",
        label: "Auth Method",
        protocols: ["integration:exchange"],
        visibleWhen: showsExchangeOnPremisesFields,
        optionText: ["Basic", "Negotiate", "Kerberos"],
        valuePaths: ["integration.providerFields.authMethod"],
      },
      {
        id: "exchange-use-ssl",
        label: "Use SSL",
        protocols: ["integration:exchange"],
        visibleWhen: showsExchangeOnPremisesFields,
      },
      {
        id: "exchange-skip-cert-check",
        label: "Skip Cert",
        protocols: ["integration:exchange"],
        visibleWhen: showsExchangeOnPremisesFields,
      },
    ],
  },
  {
    id: "protocol-options",
    tabId: "protocol",
    label: "Protocol Options",
    keywords: [
      "ssh",
      "ard",
      "apple remote desktop",
      "macos screen sharing",
      "telnet",
      "sftp",
      "mysql",
      "mariadb",
      "postgresql",
      "postgres",
      "pgsql",
      "spice",
      "remote-viewer",
      "virt-viewer",
      "xdmcp",
      "x server",
      "x2go",
      "nomachine",
      "nx",
      "smb",
      "samba",
      "rustdesk",
      "serial",
      "rs-232",
      "com port",
      "tty",
      "console cable",
      "http",
      "https",
      "cloud",
      "rdp",
      "winrm",
      "totp",
      "backup codes",
      "security questions",
      "recovery",
    ],
    copy: ["Settings shown for the selected connection protocol."],
    fields: [
      {
        id: "telnet-plaintext",
        label: "Plaintext terminal",
        protocols: ["telnet"],
        protocolSubtabId: "connection",
        keywords: ["telnet", "unencrypted", "legacy terminal"],
        copy: ["Use only on a trusted network or separately secured path."],
      },
      {
        id: "serial-device",
        label: "Local serial device",
        protocols: ["serial"],
        protocolSubtabId: "connection",
        keywords: ["serial", "rs-232", "com port", "tty", "device path"],
        copy: ["Scan devices", "COM3", "/dev/ttyUSB0"],
        valuePaths: ["serialSettings.portName"],
      },
      {
        id: "serial-baud-rate",
        label: "Baud rate",
        protocols: ["serial"],
        protocolSubtabId: "connection",
        keywords: ["speed", "bps"],
        optionText: [
          "300",
          "1200",
          "2400",
          "4800",
          "9600",
          "19200",
          "38400",
          "57600",
          "115200",
          "230400",
          "460800",
          "921600",
        ],
        valuePaths: ["serialSettings.baudRate"],
      },
      {
        id: "serial-data-bits",
        label: "Data bits",
        protocols: ["serial"],
        protocolSubtabId: "connection",
        keywords: ["framing", "word length", "8n1"],
        optionText: ["5", "6", "7", "8"],
        valuePaths: ["serialSettings.dataBits"],
      },
      {
        id: "serial-parity",
        label: "Parity",
        protocols: ["serial"],
        protocolSubtabId: "connection",
        keywords: ["framing", "8n1", "odd", "even"],
        optionText: ["None", "Odd", "Even"],
        valuePaths: ["serialSettings.parity"],
      },
      {
        id: "serial-stop-bits",
        label: "Stop bits",
        protocols: ["serial"],
        protocolSubtabId: "connection",
        keywords: ["framing", "8n1"],
        optionText: ["1", "2"],
        valuePaths: ["serialSettings.stopBits"],
      },
      {
        id: "serial-flow-control",
        label: "Flow control",
        protocols: ["serial"],
        protocolSubtabId: "connection",
        keywords: ["xon", "xoff", "rts", "cts", "hardware", "software"],
        optionText: ["None", "Software (XON/XOFF)", "Hardware (RTS/CTS)"],
        valuePaths: ["serialSettings.flowControl"],
        copy: [
          "Mark/Space parity, 1.5 stop bits, and distinct DTR/DSR flow control are not offered.",
        ],
      },
      {
        id: "serial-line-ending",
        label: "Line ending",
        protocols: ["serial"],
        protocolSubtabId: "terminal",
        keywords: ["enter", "newline", "cr", "lf", "crlf"],
        optionText: ["None", "CR", "LF", "CRLF"],
        valuePaths: ["serialSettings.lineEnding"],
      },
      {
        id: "serial-local-echo",
        label: "Local echo",
        protocols: ["serial"],
        protocolSubtabId: "terminal",
        keywords: ["terminal input", "typed characters"],
        valuePaths: ["serialSettings.localEcho"],
      },
      {
        id: "serial-control-open",
        label: "Control lines on open",
        protocols: ["serial"],
        protocolSubtabId: "advanced",
        keywords: ["dtr", "rts", "data terminal ready", "request to send"],
        valuePaths: ["serialSettings.dtrOnOpen", "serialSettings.rtsOnOpen"],
      },
      {
        id: "serial-timeouts",
        label: "Serial timeouts",
        protocols: ["serial"],
        protocolSubtabId: "advanced",
        keywords: ["read timeout", "write timeout", "milliseconds"],
        valuePaths: [
          "serialSettings.readTimeoutMs",
          "serialSettings.writeTimeoutMs",
        ],
      },
      {
        id: "serial-buffers",
        label: "Serial buffers",
        protocols: ["serial"],
        protocolSubtabId: "advanced",
        keywords: ["receive buffer", "transmit buffer", "rx", "tx"],
        valuePaths: [
          "serialSettings.rxBufferSize",
          "serialSettings.txBufferSize",
        ],
      },
      {
        id: "serial-character-delay",
        label: "Character delay",
        protocols: ["serial"],
        protocolSubtabId: "advanced",
        keywords: ["inter character", "typing delay", "milliseconds"],
        valuePaths: ["serialSettings.charDelayMs"],
      },
      {
        id: "sftp-auth-type",
        label: "SFTP authentication",
        protocols: ["sftp"],
        protocolSubtabId: "authentication",
        optionText: ["Username and password", "Username and private key"],
        valuePaths: ["authType"],
      },
      {
        id: "sftp-username",
        label: "SFTP username",
        protocols: ["sftp"],
        protocolSubtabId: "authentication",
        valuePaths: ["username"],
      },
      {
        id: "sftp-password",
        label: "SFTP password",
        protocols: ["sftp"],
        protocolSubtabId: "authentication",
        visibleWhen: (formData) => formData.authType !== "key",
      },
      {
        id: "sftp-private-key",
        label: "SFTP private key",
        protocols: ["sftp"],
        protocolSubtabId: "authentication",
        visibleWhen: (formData) => formData.authType === "key",
      },
      {
        id: "ftp-remote-path",
        label: "FTP initial remote directory",
        protocols: ["ftp"],
        protocolSubtabId: "connection",
        keywords: ["starting folder", "initial path"],
        valuePaths: ["remotePath"],
      },
      {
        id: "ftp-data-channel-mode",
        label: "FTP data connection mode",
        protocols: ["ftp"],
        protocolSubtabId: "connection",
        keywords: ["passive", "pasv", "epsv", "extended passive"],
        optionText: ["Passive (PASV)", "Extended passive (EPSV)"],
        valuePaths: ["ftpDataChannelMode"],
      },
      {
        id: "ftp-username",
        label: "FTP username",
        protocols: ["ftp"],
        protocolSubtabId: "authentication",
        keywords: ["anonymous", "login"],
        valuePaths: ["username"],
      },
      {
        id: "ftp-password",
        label: "FTP password",
        protocols: ["ftp"],
        protocolSubtabId: "authentication",
      },
      {
        id: "ftp-security-mode",
        label: "FTP transport security",
        protocols: ["ftp"],
        protocolSubtabId: "security",
        keywords: ["ftp", "ftps", "tls", "auth tls", "implicit"],
        optionText: [
          "FTP (unencrypted)",
          "Explicit FTPS (AUTH TLS)",
          "Implicit FTPS",
        ],
        valuePaths: ["ftpSecurity"],
      },
      {
        id: "ftp-invalid-certificates",
        label: "Accept invalid FTP TLS certificates",
        protocols: ["ftp"],
        protocolSubtabId: "security",
        keywords: ["unsafe", "self signed", "certificate validation"],
        valuePaths: ["ftpAcceptInvalidCerts"],
      },
      {
        id: "ftp-connect-timeout",
        label: "FTP connect timeout",
        protocols: ["ftp"],
        protocolSubtabId: "advanced",
        keywords: ["seconds", "connection timing"],
        valuePaths: ["ftpConnectTimeoutSec"],
      },
      {
        id: "ftp-data-timeout",
        label: "FTP data timeout",
        protocols: ["ftp"],
        protocolSubtabId: "advanced",
        keywords: ["transfer timeout", "seconds"],
        valuePaths: ["ftpDataTimeoutSec"],
      },
      {
        id: "ftp-utf8",
        label: "FTP UTF-8 file names",
        protocols: ["ftp"],
        protocolSubtabId: "advanced",
        keywords: ["encoding", "unicode", "filenames"],
        valuePaths: ["ftpUtf8"],
      },
      {
        id: "scp-remote-path",
        label: "SCP initial remote directory",
        protocols: ["scp"],
        protocolSubtabId: "connection",
        keywords: ["starting folder", "initial path"],
        valuePaths: ["remotePath"],
      },
      {
        id: "scp-auth-type",
        label: "SCP authentication",
        protocols: ["scp"],
        protocolSubtabId: "authentication",
        optionText: ["Username and password", "Username and private key"],
        valuePaths: ["authType"],
      },
      {
        id: "scp-username",
        label: "SCP username",
        protocols: ["scp"],
        protocolSubtabId: "authentication",
        valuePaths: ["username"],
      },
      {
        id: "scp-password",
        label: "SCP password",
        protocols: ["scp"],
        protocolSubtabId: "authentication",
        visibleWhen: (formData) => formData.authType !== "key",
      },
      {
        id: "scp-private-key",
        label: "SCP private key",
        protocols: ["scp"],
        protocolSubtabId: "authentication",
        visibleWhen: (formData) => formData.authType === "key",
      },
      {
        id: "scp-passphrase",
        label: "SCP private-key passphrase",
        protocols: ["scp"],
        protocolSubtabId: "authentication",
        visibleWhen: (formData) => formData.authType === "key",
      },
      {
        id: "scp-host-key-policy",
        label: "SCP host-key policy",
        protocols: ["scp"],
        protocolSubtabId: "security",
        keywords: ["known hosts", "tofu", "trust", "fingerprint", "strict"],
        optionText: [
          "Fail closed for unknown hosts (safe default)",
          "Trust on first use (accept new)",
          "Ask policy (fails closed without a prompt)",
          "Strict (known hosts only)",
        ],
        valuePaths: ["sshTrustPolicy"],
      },
      {
        id: "scp-ignore-host-key-errors",
        label: "Ignore SCP host-key errors",
        protocols: ["scp"],
        protocolSubtabId: "security",
        keywords: ["unsafe", "skip verification", "always trust"],
        valuePaths: ["ignoreSshSecurityErrors"],
      },
      {
        id: "scp-known-hosts-path",
        label: "SCP custom known_hosts path",
        protocols: ["scp"],
        protocolSubtabId: "security",
        keywords: ["known hosts", "custom path", "fingerprint"],
        valuePaths: ["sshKnownHostsPath"],
      },
      {
        id: "scp-connect-timeout",
        label: "SCP connect timeout",
        protocols: ["scp"],
        protocolSubtabId: "advanced",
        keywords: ["seconds", "connection timing"],
        valuePaths: ["sshConnectTimeout"],
      },
      {
        id: "scp-compression",
        label: "SCP SSH compression",
        protocols: ["scp"],
        protocolSubtabId: "advanced",
        keywords: ["slow link", "bandwidth"],
        valuePaths: ["sshConnectionConfigOverride.enableCompression"],
      },
      {
        id: "mysql-database",
        label: "Default database",
        protocols: ["mysql"],
        protocolSubtabId: "connection",
        keywords: ["mysql", "mariadb", "schema"],
        valuePaths: ["database"],
      },
      {
        id: "postgresql-database",
        label: "PostgreSQL default database",
        protocols: ["postgresql"],
        protocolSubtabId: "connection",
        keywords: ["postgres", "pgsql", "catalog"],
        valuePaths: ["database"],
      },
      {
        id: "postgresql-username",
        label: "PostgreSQL username",
        protocols: ["postgresql"],
        protocolSubtabId: "authentication",
        keywords: ["postgres", "account", "role"],
        valuePaths: ["username"],
      },
      {
        id: "postgresql-password",
        label: "PostgreSQL password",
        protocols: ["postgresql"],
        protocolSubtabId: "authentication",
        keywords: ["postgres", "credential"],
      },
      {
        id: "postgresql-ssl-mode",
        label: "PostgreSQL SSL mode",
        protocols: ["postgresql"],
        protocolSubtabId: "security",
        keywords: ["tls", "encryption", "certificate verification"],
        optionText: [
          "Disable",
          "Allow",
          "Prefer (default)",
          "Require encryption",
          "Verify CA",
          "Verify CA and hostname",
        ],
        valuePaths: ["postgresSslMode"],
      },
      {
        id: "postgresql-ca-certificate",
        label: "PostgreSQL CA certificate path",
        protocols: ["postgresql"],
        protocolSubtabId: "security",
        keywords: ["ssl root certificate", "trust", "verify ca"],
        valuePaths: ["postgresCaCertificatePath"],
      },
      {
        id: "postgresql-client-certificate",
        label: "PostgreSQL client certificate path",
        protocols: ["postgresql"],
        protocolSubtabId: "security",
        keywords: ["mutual tls", "mtls", "ssl certificate"],
        valuePaths: ["postgresClientCertificatePath"],
      },
      {
        id: "postgresql-client-key",
        label: "PostgreSQL client key path",
        protocols: ["postgresql"],
        protocolSubtabId: "security",
        keywords: ["mutual tls", "mtls", "ssl key"],
        valuePaths: ["postgresClientKeyPath"],
      },
      {
        id: "postgresql-connect-timeout",
        label: "PostgreSQL connect timeout",
        protocols: ["postgresql"],
        protocolSubtabId: "advanced",
        keywords: ["seconds", "connection timing"],
        valuePaths: ["postgresConnectionTimeoutSecs"],
      },
      {
        id: "postgresql-direct-route",
        label: "PostgreSQL direct-only network path",
        protocols: ["postgresql"],
        protocolSubtabId: "advanced",
        keywords: ["proxy", "vpn", "ssh hop", "tunnel chain", "fail closed"],
        copy: [
          "Configured proxy, VPN, SSH hop, or tunnel chain is rejected before credentials are sent.",
        ],
      },
      ...NATIVE_DISPLAY_CONNECTION_EDITOR_FIELDS,
      {
        id: "smb-share",
        label: "Share name",
        protocols: ["smb"],
        protocolSubtabId: "connection",
        keywords: ["windows share", "samba", "unc"],
        valuePaths: ["shareName"],
      },
      {
        id: "smb-workgroup",
        label: "Workgroup",
        protocols: ["smb"],
        protocolSubtabId: "connection",
        valuePaths: ["workgroup"],
      },
      {
        id: "rustdesk-id",
        label: "Remote device ID",
        protocols: ["rustdesk"],
        protocolSubtabId: "connection",
        keywords: ["rustdesk", "remote id", "device id"],
        valuePaths: ["rustdeskId"],
      },
      {
        id: "rustdesk-password",
        label: "Unattended password",
        protocols: ["rustdesk"],
        protocolSubtabId: "connection",
        keywords: ["rustdesk credential"],
      },
      {
        id: "ard-auto-reconnect",
        label: "Automatically reconnect",
        protocols: ["ard"],
        protocolSubtabId: "connection",
        copy: [
          "Apple Remote Desktop",
          "macOS Screen Sharing",
          "Embedded ARD session",
          "RFB port 5900",
        ],
        valuePaths: ["ardSettings.autoReconnect"],
      },
      {
        id: "ard-auth-mode",
        label: "Authentication mode",
        protocols: ["ard"],
        protocolSubtabId: "authentication",
        optionText: [
          "Remote Mac account (embedded ARD)",
          "Legacy VNC password (embedded RFB)",
          "Apple Account via Screen Sharing.app",
        ],
        valuePaths: ["ardSettings.authMode"],
      },
      {
        id: "ard-username",
        label: "Remote Mac username",
        protocols: ["ard"],
        protocolSubtabId: "authentication",
        visibleWhen: (formData) =>
          (formData.ardSettings as Record<string, unknown> | undefined)
            ?.authMode !== "vncPassword" &&
          (formData.ardSettings as Record<string, unknown> | undefined)
            ?.authMode !== "appleAccountNative",
        valuePaths: ["username"],
      },
      {
        id: "ard-password",
        label: "ARD or VNC password",
        protocols: ["ard"],
        protocolSubtabId: "authentication",
        visibleWhen: (formData) =>
          (formData.ardSettings as Record<string, unknown> | undefined)
            ?.authMode !== "appleAccountNative",
        keywords: ["credential", "remote mac", "vnc server"],
      },
      {
        id: "ard-native-handoff",
        label: "Apple Screen Sharing handoff",
        protocols: ["ard"],
        protocolSubtabId: "authentication",
        visibleWhen: (formData) =>
          (formData.ardSettings as Record<string, unknown> | undefined)
            ?.authMode === "appleAccountNative",
        copy: [
          "Sign in or approve in Screen Sharing.app",
          "No Apple Account password is stored or sent by this app",
          "macOS only",
        ],
      },
      {
        id: "ard-display-input",
        label: "ARD display and input",
        protocols: ["ard"],
        protocolSubtabId: "display-input",
        copy: ["Show local cursor", "View only", "Curtain mode on connect"],
        valuePaths: [
          "ardSettings.localCursor",
          "ardSettings.viewOnly",
          "ardSettings.curtainOnConnect",
        ],
      },
      {
        id: "network-path",
        focusId: "network-path-section",
        label: "Network Path",
        protocols: ["ssh", "rdp", "raw", "rlogin", "winrm"],
        protocolSubtabId: "network-path",
        keywords: [
          "route",
          "routing",
          "bastion",
          "jump host",
          "vpn chain",
          "proxy chain",
          "tunnel chain",
        ],
        copy: [
          "Connection chain",
          "Proxy chain",
          "Tunnel chain",
          "Inline VPN",
          "Per-connection proxy",
          "Resolved ordered path",
          "Deterministic path policy",
          "Fail closed",
        ],
        optionText: [
          "OpenVPN",
          "WireGuard",
          "Tailscale",
          "ZeroTier",
          "HTTP",
          "HTTPS",
          "SOCKS4",
          "SOCKS5",
          "SSH jump",
          "SSH tunnel",
        ],
        valuePaths: [
          "connectionChainId",
          "proxyChainId",
          "tunnelChainId",
          "security.tunnelChain",
          "security.proxy",
        ],
      },
      {
        id: "ssh-username",
        focusId: "username",
        label: "Username",
        protocols: ["ssh"],
        copy: ["The SSH username used to authenticate with the remote host."],
        valuePaths: ["username"],
      },
      {
        id: "ssh-authentication",
        focusId: "protocol-options",
        label: "Authentication Type",
        protocols: ["ssh"],
        optionText: ["Password", "Private Key"],
        valuePaths: ["authType"],
      },
      {
        id: "ssh-host-key-trust",
        focusId: "protocol-options",
        label: "Host Key Trust Policy",
        protocols: ["ssh"],
        copy: [
          "Ignore SSH security errors (host keys/certs)",
          "Determines how unknown or changed host keys are handled for this connection.",
        ],
        optionText: [
          "Use global default",
          "Trust On First Use (TOFU)",
          "Always Ask",
          "Always Trust (skip verification)",
          "Strict (reject unless pre-approved)",
        ],
        valuePaths: ["sshTrustPolicy"],
      },
      {
        id: "ssh-known-hosts",
        focusId: "protocol-options",
        label: "Known Hosts Path",
        protocols: ["ssh"],
        copy: ["Path to the known_hosts file used for host key verification."],
        valuePaths: ["sshKnownHostsPath"],
      },
      {
        id: "ssh-password",
        focusId: "password",
        label: "Password",
        protocols: ["ssh"],
        visibleWhen: (formData) => formData.authType === "password",
        copy: ["The password used for SSH password authentication."],
      },
      {
        id: "ssh-private-key",
        focusId: "protocol-options",
        label: "Private Key",
        protocols: ["ssh"],
        visibleWhen: (formData) => formData.authType === "key",
        copy: ["PEM or PPK private key", "Passphrase (optional)"],
      },
      {
        id: "ssh-connection-timing",
        focusId: "protocol-options",
        label: "Connect Timeout (sec)",
        protocols: ["ssh"],
        copy: [
          "Keep Alive (sec)",
          "Maximum time to wait for the SSH connection.",
        ],
      },
      {
        id: "http-authentication",
        focusId: "protocol-options",
        label: "Authentication Type",
        protocols: ["http", "https"],
        optionText: ["Basic Authentication", "Custom Headers"],
        valuePaths: ["authType"],
      },
      {
        id: "http-basic-username",
        focusId: "protocol-options",
        label: "Basic Auth Username",
        protocols: ["http", "https"],
        visibleWhen: (formData) => (formData.authType ?? "basic") === "basic",
        valuePaths: ["basicAuthUsername"],
      },
      {
        id: "http-basic-password",
        focusId: "protocol-options",
        label: "Basic Auth Password",
        protocols: ["http", "https"],
        visibleWhen: (formData) => (formData.authType ?? "basic") === "basic",
      },
      {
        id: "http-realm",
        focusId: "protocol-options",
        label: "Realm (Optional)",
        protocols: ["http", "https"],
        visibleWhen: (formData) => (formData.authType ?? "basic") === "basic",
        valuePaths: ["basicAuthRealm"],
      },
      {
        id: "http-auto-login",
        focusId: "protocol-options",
        label: "Auto-login to this site",
        protocols: ["http", "https"],
        copy: [
          "Automatically fills and submits this connection's saved credentials.",
          "Multi-factor / CAPTCHA prompts are left to you.",
        ],
      },
      {
        id: "http-auto-login-selectors",
        focusId: "protocol-options",
        label: "Advanced: form field selectors (optional)",
        protocols: ["http", "https"],
        visibleWhen: (formData) => formData.httpAutoLogin === true,
        copy: [
          "Username field selector",
          "Password field selector",
          "Submit button selector",
        ],
        valuePaths: [
          "httpAutoLoginSelectors.usernameSelector",
          "httpAutoLoginSelectors.submitSelector",
        ],
      },
      {
        id: "http-tls",
        focusId: "protocol-options",
        label: "Verify TLS certificates",
        protocols: ["http", "https"],
        copy: ["Disable only for self-signed certificates."],
      },
      {
        id: "http-trust-policy",
        focusId: "protocol-options",
        label: "HTTPS Certificate Trust Policy",
        protocols: ["http", "https"],
        optionText: [
          "Use global default",
          "Trust On First Use (TOFU)",
          "Always Ask",
          "Always Trust",
          "Strict",
        ],
        valuePaths: ["httpsTrustPolicy", "tlsTrustPolicy"],
      },
      {
        id: "http-custom-headers",
        focusId: "protocol-options",
        label: "Custom HTTP Headers",
        protocols: ["http", "https"],
        visibleWhen: (formData) => formData.authType === "header",
        copy: ["Additional HTTP headers sent with every request."],
      },
      {
        id: "http-bookmarks",
        focusId: "protocol-options",
        label: "Bookmarks",
        protocols: ["http", "https"],
        valuePaths: ["httpBookmarks"],
      },
      {
        id: "rdp-target-os",
        focusId: "protocol-options",
        label: "Target OS",
        protocols: ["rdp"],
        optionText: ["Windows", "Linux / Other"],
        valuePaths: ["osType"],
      },
      {
        id: "rdp-domain",
        focusId: "protocol-options",
        label: "Domain",
        protocols: ["rdp"],
        valuePaths: ["domain"],
      },
      {
        id: "rdp-display",
        focusId: "protocol-options",
        label: "Display",
        protocols: ["rdp"],
        copy: ["Resolution", "Color depth", "Smart sizing", "Desktop scale"],
        valuePaths: ["rdpSettings.display"],
      },
      {
        id: "rdp-audio",
        focusId: "protocol-options",
        label: "Audio",
        protocols: ["rdp"],
        copy: ["Playback", "Recording", "Audio quality"],
        valuePaths: ["rdpSettings.audio"],
      },
      {
        id: "rdp-input",
        focusId: "protocol-options",
        label: "Input",
        protocols: ["rdp"],
        copy: ["Mouse", "Keyboard", "Keyboard layout", "Unicode input"],
        valuePaths: ["rdpSettings.input"],
      },
      {
        id: "rdp-devices",
        focusId: "protocol-options",
        label: "Device Redirection",
        protocols: ["rdp"],
        copy: [
          "Clipboard",
          "Drives",
          "Printers",
          "Smart cards",
          "WebAuthn",
          "USB devices",
        ],
        valuePaths: ["rdpSettings.deviceRedirection"],
      },
      {
        id: "rdp-performance",
        focusId: "protocol-options",
        label: "Performance",
        protocols: ["rdp"],
        copy: [
          "Wallpaper",
          "Font smoothing",
          "Desktop composition",
          "Connection speed",
          "Target FPS",
        ],
        valuePaths: ["rdpSettings.performance"],
      },
      {
        id: "rdp-security",
        focusId: "protocol-options",
        label: "Security",
        protocols: ["rdp"],
        copy: ["TLS", "NLA", "CredSSP", "Certificate validation"],
        valuePaths: ["rdpSettings.security"],
      },
      {
        id: "rdp-gateway",
        focusId: "protocol-options",
        label: "RDP Gateway",
        protocols: ["rdp"],
        copy: [
          "Gateway server",
          "Authentication method",
          "Credential source",
          "Transport mode",
        ],
        valuePaths: ["rdpSettings.gateway"],
      },
      {
        id: "rdp-hyper-v",
        focusId: "protocol-options",
        label: "Hyper-V",
        protocols: ["rdp"],
        copy: ["VM ID", "Enhanced Session Mode", "Host server"],
        valuePaths: ["rdpSettings.hyperv"],
      },
      {
        id: "rdp-negotiation",
        focusId: "protocol-options",
        label: "Negotiation",
        protocols: ["rdp"],
        copy: ["Auto-detect", "Strategy", "Retry delay", "Load balancing"],
        valuePaths: ["rdpSettings.negotiation"],
      },
      {
        id: "rdp-advanced",
        focusId: "protocol-options",
        label: "Advanced",
        protocols: ["rdp"],
        copy: [
          "Session close policy",
          "Client name",
          "Read timeout",
          "Stats interval",
        ],
        valuePaths: ["rdpSettings.advanced"],
      },
      {
        id: "rdp-tcp",
        focusId: "protocol-options",
        label: "TCP",
        protocols: ["rdp"],
        copy: ["Connect timeout", "TCP_NODELAY", "Keep-alive", "Socket buffer"],
        valuePaths: ["rdpSettings.tcp"],
      },
      {
        id: "winrm-options",
        focusId: "protocol-options",
        label: "Windows Remote Management (WinRM)",
        copy: [
          "Enable WinRM Tools",
          "Domain",
          "Transport",
          "Authentication",
          "TLS",
          "WMI namespace",
          "Use global",
          "Enabled",
          "Disabled",
        ],
        visibleWhen: (formData) =>
          formData.protocol === "winrm" ||
          formData.protocol === "rdp" ||
          formData.osType === "windows",
        valuePaths: ["domain", "winrmSettings"],
      },
      {
        id: "cloud-gcp",
        focusId: "protocol-options",
        label: "Google Cloud Provider Configuration",
        protocols: ["gcp"],
        copy: [
          "Project ID",
          "Zone",
          "Service Account Key (JSON)",
          "Instance ID/Name",
        ],
        valuePaths: [
          "cloudProvider.projectId",
          "cloudProvider.zone",
          "cloudProvider.instanceId",
          "cloudProvider.instanceName",
        ],
      },
      {
        id: "cloud-azure",
        focusId: "protocol-options",
        label: "Azure Cloud Provider Configuration",
        protocols: ["azure"],
        copy: [
          "Subscription ID",
          "Resource Group",
          "Client ID",
          "Client Secret",
          "Tenant ID",
          "Instance ID/Name",
        ],
        valuePaths: [
          "cloudProvider.subscriptionId",
          "cloudProvider.resourceGroup",
          "cloudProvider.clientId",
          "cloudProvider.tenantId",
          "cloudProvider.instanceId",
          "cloudProvider.instanceName",
        ],
      },
      {
        id: "cloud-digital-ocean",
        focusId: "protocol-options",
        label: "Digital Ocean Cloud Provider Configuration",
        protocols: ["digital-ocean"],
        copy: ["API Key", "Region", "Instance ID/Name"],
        valuePaths: [
          "cloudProvider.region",
          "cloudProvider.instanceId",
          "cloudProvider.instanceName",
        ],
      },
      {
        id: "two-factor",
        focusId: "protocol-options",
        label: "2FA / TOTP",
        copy: [
          "Time-based One-Time Password configurations for two-factor authentication.",
        ],
      },
      {
        id: "backup-codes",
        focusId: "protocol-options",
        label: "Backup Codes",
        keywords: ["recovery codes"],
      },
      {
        id: "security-questions",
        focusId: "protocol-options",
        label: "Security Questions",
      },
      {
        id: "recovery-information",
        focusId: "protocol-options",
        label: "Recovery Information",
      },
    ],
    connectionOnly: true,
  },
  {
    id: "behavior-focus",
    tabId: "behavior",
    label: "Focus Behavior",
    keywords: ["behavior", "focus", "background", "windows management"],
    fields: [
      { id: "focus-on-connect", label: "On Connect" },
      {
        id: "focus-on-winmgmt-tool",
        label: "On Windows Management Tool",
        keywords: ["winrm", "rdp"],
        visibleWhen: (formData) =>
          formData.osType === "windows" ||
          formData.protocol === "rdp" ||
          formData.protocol === "winrm",
      },
    ],
    connectionOnly: true,
  },
  {
    id: "behavior-connection",
    tabId: "behavior",
    label: "Connection Policy Overrides",
    keywords: ["behavior", "retry", "close", "inherit", "global"],
    copy: [
      "Leave numeric values empty or choose Use global setting to inherit application defaults.",
    ],
    fields: [
      {
        id: "retry-attempts",
        label: "Retry attempts",
        copy: ["Global", "0 disables automatic retries for this connection."],
      },
      {
        id: "retry-delay",
        label: "Retry delay (ms)",
        copy: ["Global"],
      },
      {
        id: "warn-on-close",
        label: "Warn on close",
        optionText: [
          "Use global setting",
          "Warn before closing",
          "Close without warning",
        ],
      },
      {
        id: "enable-winrm-tools",
        label: "WinRM tools",
        optionText: ["Use global setting", "Enabled", "Disabled"],
        visibleWhen: (formData) =>
          formData.osType === "windows" ||
          formData.protocol === "rdp" ||
          formData.protocol === "winrm",
      },
    ],
    connectionOnly: true,
  },
  {
    id: "behavior-automation",
    tabId: "behavior",
    label: "Session Automation",
    keywords: [
      "behavior",
      "rules",
      "events",
      "actions",
      "lifecycle",
      "window",
      "focus",
      "minimize",
      "restore",
      "close",
      "detached",
    ],
    copy: [
      "Rules run in order. Actions inside each matching rule also run in order.",
      "Add automation rule",
      "No automation rules. Add one to react to a session lifecycle event.",
      "This automation cannot be safely edited in the version 1 editor.",
      "Replace with an empty version 1 automation",
    ],
    fields: [
      {
        id: "behavior-automation",
        label: "Session automation",
        optionText: [
          "Show notification",
          "Write log entry",
          "Reconnect",
          "Run saved script",
          "Focus session and owning window",
          "Close session tab",
          "Set owning window state",
          "Window focused",
          "Window blurred",
          "Window minimized",
          "Window restored",
          "Window close requested",
          "Window closed",
          "Main window",
          "Detached windows",
        ],
      },
    ],
    dynamicFields: getBehaviorAutomationFields,
    connectionOnly: true,
  },
  {
    id: "organize-icon",
    tabId: "organize",
    label: "Connection Icon",
    keywords: [
      "organize",
      "icon",
      "appearance",
      "symbol",
      "automatic",
      "manual override",
      "palette",
    ],
    copy: [
      "Search icons by label, key, category, protocol, or integration.",
      "Use the automatic protocol or integration icon.",
    ],
    fields: [{ id: "icon", label: "Connection Icon", valuePaths: ["icon"] }],
  },
  {
    id: "organize-tags",
    tabId: "organize",
    label: "Tags",
    keywords: ["organize", "tags", "labels"],
    fields: [{ id: "tags", label: "Tags", valuePaths: ["tags"] }],
  },
  {
    id: "notes-description",
    tabId: "notes",
    label: "Description & Notes",
    keywords: ["notes", "description", "documentation", "comments"],
    copy: ["Add notes about this connection."],
    fields: [
      {
        id: "description",
        label: "Description & Notes",
        keywords: ["owner", "documentation", "comments"],
        valuePaths: ["description"],
      },
    ],
  },
  RAW_SOCKET_CONNECTION_EDITOR_SEARCH_DESCRIPTOR,
  ...RLOGIN_CONNECTION_EDITOR_SEARCH_DESCRIPTORS,
  POWERSHELL_REMOTING_CONNECTION_EDITOR_SEARCH_DESCRIPTOR,
] as const satisfies readonly ConnectionEditorSearchDescriptor[];

export function getConnectionEditorTabs(
  isGroup: boolean,
): readonly ConnectionEditorTabDescriptor[] {
  return CONNECTION_EDITOR_TABS.filter(
    (tab) => !isGroup || !("connectionOnly" in tab) || !tab.connectionOnly,
  );
}

export function getConnectionEditorSearchDescriptors(
  isGroup: boolean,
): readonly ConnectionEditorSearchDescriptor[] {
  return CONNECTION_EDITOR_SEARCH_DESCRIPTORS.filter(
    (descriptor) =>
      !isGroup ||
      !("connectionOnly" in descriptor) ||
      !descriptor.connectionOnly,
  );
}

export function navigateToConnectionEditorSearchDescriptor(
  sectionId: string,
  handlers: ConnectionEditorSearchNavigationHandlers,
  fieldId?: string,
  descriptors: readonly ConnectionEditorSearchDescriptor[] = CONNECTION_EDITOR_SEARCH_DESCRIPTORS,
): boolean {
  const descriptor = descriptors.find(
    (candidate) => candidate.id === sectionId,
  );
  if (!descriptor) return false;

  const field = fieldId
    ? descriptor.fields.find((candidate) => candidate.id === fieldId)
    : undefined;
  if (fieldId && !field) return false;

  handlers.activateTab(descriptor.tabId);
  if (descriptor.expandableSectionId) {
    handlers.expandSection?.(descriptor.expandableSectionId);
  }
  if (field) {
    handlers.focusField?.(
      field.focusId ?? field.id,
      descriptor.id,
      field.label,
    );
  }

  return true;
}
