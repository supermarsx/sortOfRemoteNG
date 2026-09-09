import type {
  HttpApplicationSettings,
  HttpAutoLoginSelectors,
} from "../../types/connection/connection";
import { PORTAINER_AUTO_LOGIN_SELECTORS } from "../../components/integrations/portainer/webUiLaunch";
import { NPM_AUTO_LOGIN_SELECTORS } from "../../components/integrations/nginxProxyMgr/webUiLaunch";
import { PROXMOX_AUTO_LOGIN_SELECTORS } from "../../components/integrations/proxmox/webUiLaunch";
import { PFSENSE_AUTO_LOGIN_SELECTORS } from "../../components/integrations/pfsense/webUiLaunch";

export interface HttpApplicationProfile {
  id: string;
  label: string;
  category: HttpApplicationCategory;
  capability:
    | "known-form"
    | "generic-form"
    | "custom-form"
    | "http-auth"
    | "manual"
    | "none";
  description: string;
  usernameLabel?: string;
  selectors?: Readonly<HttpAutoLoginSelectors>;
}

export const HTTP_APPLICATION_CATEGORIES = {
  containers: "Containers",
  virtualization: "Virtualization",
  management: "Server management / BMC",
  networking: "Networking / proxies",
  monitoring: "Monitoring",
  business: "Business applications",
  mailStorage: "Mail / storage",
  custom: "Custom websites",
  native: "Native integration only",
} as const;
export type HttpApplicationCategory = keyof typeof HTTP_APPLICATION_CATEGORIES;

const generic = (
  id: string,
  label: string,
  category: HttpApplicationCategory,
  description = "Optional generic login-form detection; no application-specific browser sign-in has been verified.",
): HttpApplicationProfile => ({
  id,
  label,
  category,
  capability: "generic-form",
  description,
});
const unavailable = (
  id: string,
  label: string,
  description: string,
): HttpApplicationProfile => ({
  id,
  label,
  category: "native",
  capability: "none",
  description,
});

/** Browser capabilities, not a claim that every native API credential logs into a website. */
export const HTTP_APPLICATION_PROFILES: readonly HttpApplicationProfile[] = [
  {
    id: "custom",
    label: "Custom application",
    category: "custom",
    capability: "custom-form",
    description:
      "Use your website's username, password, and submit CSS selectors. Form login requires all three selectors; it never falls back to heuristic detection.",
  },
  {
    id: "portainer",
    category: "containers",
    label: "Portainer",
    capability: "known-form",
    selectors: PORTAINER_AUTO_LOGIN_SELECTORS,
    description:
      "Reviewed username/password form selectors. Portainer API keys cannot sign into the web form.",
  },
  {
    id: "nginxProxyMgr",
    category: "networking",
    label: "Nginx Proxy Manager",
    capability: "known-form",
    usernameLabel: "Email",
    selectors: NPM_AUTO_LOGIN_SELECTORS,
    description:
      "Reviewed current and legacy email/password forms. API bearer tokens are not browser passwords.",
  },
  {
    id: "proxmox",
    category: "virtualization",
    label: "Proxmox VE",
    capability: "known-form",
    selectors: PROXMOX_AUTO_LOGIN_SELECTORS,
    description:
      "Reviewed web login selectors; the account realm is appended at runtime. API tokens do not sign into this form.",
  },
  {
    id: "pfsense",
    category: "networking",
    label: "pfSense",
    capability: "known-form",
    selectors: PFSENSE_AUTO_LOGIN_SELECTORS,
    description:
      "Reviewed WebGUI selectors. Use the WebGUI account, not the separate REST API client credentials.",
  },
  generic(
    "ilo",
    "HP / HPE iLO",
    "management",
    "Use the iLO web account. Form detection is generic and firmware-dependent; Redfish/RIBCL session tokens do not sign into the browser. MFA remains manual.",
  ),
  {
    id: "webmin",
    label: "Webmin",
    category: "management",
    capability: "known-form",
    // Reviewed Webmin and Authentic Theme session_login.cgi sources. Target only
    // the login submit, never the separate OTP/forgot-password controls.
    selectors: {
      usernameSelector: 'form[action$="/session_login.cgi"] input[name="user"]',
      passwordSelector:
        'form[action$="/session_login.cgi"] input[name="pass"][type="password"]',
      submitSelector:
        'form[action$="/session_login.cgi"] button[data-submit="login"], form[action$="/session_login.cgi"] input[type="submit"]',
    },
    description:
      "Reviewed classic and Authentic Theme username/password forms. Webmin commonly uses HTTPS port 10000; your configured HTTP/HTTPS port is kept unchanged. Login banners, two-factor codes, and password resets remain manual; use explicit Basic only when the server requires HTTP authentication.",
  },
  generic("idrac", "Dell iDRAC", "management"),
  generic("lenovo", "Lenovo XClarity", "management"),
  generic("supermicro", "Supermicro BMC", "management"),
  generic(
    "voip-phone",
    "VoIP phone (Yealink)",
    "networking",
    "Choose Basic for firmware that uses HTTP Basic, or generic form detection for a login page. Firmware-specific native phone hints are not probed automatically.",
  ),
  generic("netbox", "NetBox", "networking"),
  generic("vmware", "VMware vSphere", "virtualization"),
  generic(
    "cpanel",
    "cPanel / WHM",
    "management",
    "Use the website account and the saved connection's cPanel/WHM port. API tokens are not browser credentials.",
  ),
  generic("draytek", "DrayTek", "networking"),
  generic("grafana", "Grafana", "monitoring"),
  generic("budibase", "Budibase", "business"),
  generic("jira", "Jira", "business"),
  generic("osticket", "osTicket", "business"),
  generic("mailcow", "Mailcow", "mailStorage"),
  ...[
    ["haproxy", "HAProxy stats"],
    ["traefik", "Traefik dashboard"],
    ["prometheus", "Prometheus"],
  ].map(([id, label]): HttpApplicationProfile => ({
    id,
    label,
    category: id === "prometheus" ? "monitoring" : "networking",
    capability: "http-auth",
    description:
      "Manual browsing or explicitly configured HTTP Basic. Native API credentials are not converted into browser sessions.",
  })),
  {
    id: "lxd",
    category: "containers",
    label: "LXD / Incus",
    capability: "manual",
    description:
      "Manual web UI only if installed. Native mutual-TLS/OIDC credentials are not transferred into the browser.",
  },
  {
    id: "exchange",
    category: "mailStorage",
    label: "Microsoft Exchange",
    capability: "manual",
    description:
      "Manual web login; native Exchange/Graph credentials are not an Outlook Web Access browser session. External identity-provider redirects may require an external browser.",
  },
  {
    id: "gdrive",
    category: "mailStorage",
    label: "Google Drive",
    capability: "manual",
    description:
      "Manual browsing only. Native OAuth tokens are not transferred to the Google website; external identity-provider sign-in is not automated.",
  },
  unavailable(
    "vmwareDesktop",
    "VMware Workstation / Fusion",
    "The existing integration manages the desktop REST API; it has no built-in browser login UI.",
  ),
  unavailable(
    "ansible",
    "Ansible",
    "The existing integration runs the Ansible CLI, not an AWX website.",
  ),
  unavailable(
    "nginx",
    "Nginx configuration",
    "The existing integration manages server configuration over SSH, not a built-in admin website.",
  ),
  unavailable(
    "caddy",
    "Caddy admin API",
    "The existing integration uses an admin API; no built-in browser login UI is provided.",
  ),
  unavailable(
    "php",
    "PHP runtime",
    "The existing integration manages PHP over SSH, not a browser login UI.",
  ),
  unavailable(
    "mssql",
    "Microsoft SQL Server",
    "The existing integration uses the SQL protocol, not a browser login UI.",
  ),
  unavailable(
    "mail",
    "Mail Server",
    "The existing integration is a mail administration hub. Use a generic website for a separately installed webmail UI.",
  ),
  unavailable(
    "keepass",
    "KeePass",
    "The existing integration opens a vault file, not a website.",
  ),
];

export function getHttpApplicationProfile(
  id: string,
): HttpApplicationProfile | undefined {
  return HTTP_APPLICATION_PROFILES.find((profile) => profile.id === id);
}

export function getHttpApplicationLoginModes(
  profile: HttpApplicationProfile,
): HttpApplicationSettings["loginMode"][] {
  if (profile.capability === "none") return [];
  if (profile.capability === "manual") return ["manual"];
  return profile.capability === "http-auth"
    ? ["manual", "basic"]
    : ["manual", "form", "basic"];
}

/** Allowlisted, bounded metadata only; invalid imports must not fall back to legacy Basic. */
export function normalizeHttpApplicationSettings(
  value: unknown,
): HttpApplicationSettings | undefined {
  if (value === undefined) return undefined;
  const raw =
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const safeString = (input: unknown, limit: number): input is string =>
    typeof input === "string" &&
    input.length > 0 &&
    input.length <= limit &&
    !Array.from(input).some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    );
  const id = safeString(raw.id, 80) ? raw.id : "invalid-profile";
  const profile = getHttpApplicationProfile(id);
  const loginMode = raw.loginMode === undefined ? "manual" : raw.loginMode;
  const validMode =
    loginMode === "manual" || loginMode === "basic" || loginMode === "form";
  const realmValid =
    raw.realm === undefined ||
    (safeString(raw.realm, 128) && /^[A-Za-z0-9._-]+$/.test(raw.realm));
  const valid =
    raw.version === 1 &&
    !!profile &&
    validMode &&
    getHttpApplicationLoginModes(profile).includes(loginMode) &&
    realmValid &&
    raw.invalid !== true;
  return {
    version: 1,
    id,
    loginMode: validMode ? loginMode : "manual",
    ...(id === "proxmox" && realmValid && typeof raw.realm === "string"
      ? { realm: raw.realm }
      : {}),
    ...(!valid ? { invalid: true as const } : {}),
  };
}
