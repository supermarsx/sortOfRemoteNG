import {
  Cloud,
  FileText,
  Settings2,
  Tag,
  Zap,
  type LucideIcon,
} from "lucide-react";

export type ConnectionEditorTabId =
  | "general"
  | "protocol"
  | "behavior"
  | "organize"
  | "notes";

export type ConnectionEditorExpandableSectionId = "advanced";

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
      }
    });
  });

  return fields;
};

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
        visibleWhen: (formData) =>
          !String(formData.protocol ?? "").startsWith("integration:"),
        valuePaths: ["hostname"],
      },
      {
        id: "port",
        label: "Port",
        excludedProtocols: ["integration:exchange"],
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
        excludedProtocols: ["ssh", "integration:exchange"],
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
        excludedProtocols: ["ssh", "integration:exchange"],
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
        label: "Gateway",
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
    keywords: ["behavior", "rules", "events", "actions", "lifecycle"],
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
        ],
      },
    ],
    dynamicFields: getBehaviorAutomationFields,
    connectionOnly: true,
  },
  {
    id: "organize-icon",
    tabId: "organize",
    label: "Custom Icon",
    keywords: ["organize", "icon", "appearance", "symbol"],
    copy: ["Choose a symbol for this connection or folder."],
    fields: [{ id: "icon", label: "Custom Icon", valuePaths: ["icon"] }],
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
