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
  totpChallenges?: readonly HttpApplicationTotpChallenge[];
}

/** Reviewed challenge DOM only. This metadata contains no authenticator secret. */
export interface HttpApplicationTotpChallenge {
  id: string;
  label: string;
  codeSelector: string;
  submitSelector: string;
  paths: readonly string[];
  submission: "post" | "spa";
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
export const CLOUDFLARE_DASHBOARD_URL = "https://dash.cloudflare.com/";

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
    id: "synology-dsm",
    label: "Synology DSM",
    category: "mailStorage",
    capability: "manual",
    description:
      "Interactive DSM website sign-in and MFA. Use the system browser at the NAS origin for security keys or approval challenges. Website sign-in does not authorize the separate native File Station API.",
  },
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
  {
    id: "cloudflare",
    label: "Cloudflare Dashboard",
    category: "networking",
    capability: "manual",
    description:
      "Hosted HTTPS dashboard with interactive sign-in and two-factor authentication. No saved password, API token, or automatic form login is supplied. Use the system browser for SSO, security keys, or unsupported embedded-browser challenges.",
  },
  {
    id: "tacticalrmm",
    label: "Tactical RMM",
    category: "management",
    capability: "known-form",
    // amidaware/tacticalrmm-web v0.101.64: LoginView.vue + routes.js.
    // Quasar forwards autocomplete to its native inputs. Scope submit to the
    // primary form; the separate OTP dialog must never receive the password.
    selectors: {
      usernameSelector: 'form input[autocomplete="username"]',
      passwordSelector:
        'form input[autocomplete="current-password"][type="password"]',
      submitSelector:
        'form:has(input[autocomplete="username"]):has(input[autocomplete="current-password"]) button[type="submit"]',
    },
    totpChallenges: [
      {
        id: "tacticalrmm-totp",
        label: "Tactical RMM authenticator token",
        codeSelector:
          '.q-dialog form input[autocomplete="one-time-code"][inputmode="numeric"]',
        submitSelector:
          '.q-dialog form:has(input[autocomplete="one-time-code"][inputmode="numeric"]) button[type="submit"]',
        paths: ["/login"],
        submission: "spa",
      },
    ],
    description:
      "HTTPS dashboard account login at /login, followed by the website's separate authenticator-token prompt. Standard installations use a separate API origin, which may not work through this single-origin viewer: use the external browser if the backend is unavailable. API keys and MeshCentral credentials are not dashboard passwords; SSO and security keys stay interactive.",
  },
  {
    id: "meshcentral",
    label: "MeshCentral",
    category: "management",
    capability: "known-form",
    // Ylianst/MeshCentral views/login.handlebars: never reset/create-account forms.
    selectors: {
      usernameSelector: '#loginpanel form input#username[name="username"]',
      passwordSelector:
        '#loginpanel form input#password[name="password"][type="password"]',
      submitSelector: '#loginpanel form input#loginButton[type="submit"]',
    },
    description:
      "Reviewed MeshCentral web account login. Authenticator, email and SMS codes share a challenge field, so second-factor selection and submission remain manual. Security keys, Duo, SSO and device enrollment are not automated; this is not an agent or API-token login.",
  },
  {
    id: "guacamole",
    label: "Apache Guacamole",
    category: "management",
    capability: "known-form",
    // Apache guacamole-client 1.6.0 login/form templates + CredentialsInfo.java.
    selectors: {
      usernameSelector: 'form.login-form input[name="username"]',
      passwordSelector:
        'form.login-form input[name="password"][type="password"]',
      submitSelector:
        'form.login-form input.login[type="submit"][name="login"]',
    },
    totpChallenges: [
      {
        id: "guacamole-totp",
        label: "Apache Guacamole TOTP extension — enrolled authenticator",
        // Angular hides enrollment only when the server sends no enrollment QR.
        codeSelector:
          'form.login-form .totp-code-field:has(> .totp-enroll.ng-hide) .totp-code input[name="guac-totp"]',
        submitSelector:
          'form.login-form input.continue-login[type="submit"][name="login"]',
        paths: ["/guacamole/", "/"],
        submission: "spa",
      },
    ],
    description:
      "Reviewed Guacamole 1.6 username/password login, normally at /guacamole/. Optional automatic codes target only the installed TOTP extension's already-enrolled challenge. Enrollment, Duo, SAML, OpenID Connect and custom authentication extensions remain interactive; remote desktop credentials are not Guacamole website credentials.",
  },
  {
    id: "wordpress",
    label: "WordPress",
    category: "business",
    capability: "known-form",
    usernameLabel: "Username or email",
    // WordPress core wp-login.php; excludes reset/registration/application tokens.
    selectors: {
      usernameSelector: 'form#loginform input#user_login[name="log"]',
      passwordSelector:
        'form#loginform input#user_pass[name="pwd"][type="password"]',
      submitSelector: 'form#loginform input#wp-submit[type="submit"]',
    },
    totpChallenges: [
      {
        id: "wordpress-two-factor-totp",
        label: "WordPress Two-Factor plugin — authenticator app",
        codeSelector:
          'form[name="validate_2fa_form"]:has(input[name="provider"][value="Two_Factor_Totp"]) input#authcode[autocomplete="one-time-code"]',
        submitSelector:
          'form[name="validate_2fa_form"]:has(input[name="provider"][value="Two_Factor_Totp"]) input#submit[type="submit"]',
        paths: ["/wp-login.php"],
        submission: "post",
      },
    ],
    description:
      "Reviewed WordPress core username/email and password form at /wp-login.php. Automatic TOTP supports only the separately selected Two-Factor plugin authenticator challenge, not every MFA plugin. Custom login themes, Wordfence, email codes, passkeys, CAPTCHA and SSO may require manual interaction.",
  },
  {
    id: "joomla",
    label: "Joomla Administrator",
    category: "business",
    capability: "known-form",
    // Joomla 5.4 administrator/modules/mod_login/tmpl/default.php.
    selectors: {
      usernameSelector:
        'form#form-login input#mod-login-username[name="username"]',
      passwordSelector:
        'form#form-login input#mod-login-password[name="passwd"][type="password"]',
      submitSelector: 'form#form-login button#btn-login-submit[type="submit"]',
    },
    description:
      "Reviewed Joomla administrator login at /administrator/. Complete the captive MFA challenge after the password step. Custom front-end login modules, third-party MFA plugins, security keys and SSO are not inferred from this administrator preset.",
  },
  {
    id: "drupal",
    label: "Drupal",
    category: "business",
    capability: "known-form",
    // Drupal core/modules/user/src/Form/UserLoginForm.php (Drupal 11).
    selectors: {
      usernameSelector:
        'form[data-drupal-selector="user-login-form"] input[name="name"]',
      passwordSelector:
        'form[data-drupal-selector="user-login-form"] input[name="pass"][type="password"]',
      submitSelector:
        'form[data-drupal-selector="user-login-form"] input[type="submit"]',
    },
    description:
      "Reviewed Drupal core username/password form at /user/login. Two-factor authentication is provided by contributed modules and their plugins, not one universal core challenge. Modified forms, passkeys, approval prompts and SSO remain interactive.",
  },
  {
    id: "payload-cms",
    label: "Payload CMS",
    category: "business",
    capability: "known-form",
    usernameLabel: "Email or username",
    // payloadcms/payload packages/ui/src/views/Login/LoginForm + LoginField.
    selectors: {
      usernameSelector:
        'form.login__form input[name="email"], form.login__form input[name="username"]',
      passwordSelector:
        'form.login__form input[name="password"][type="password"]',
      submitSelector: 'form.login__form button[type="submit"]',
    },
    description:
      "Reviewed Payload admin email/username and password form, normally /admin/login. Admin routes, authentication strategies and MFA are project-configurable; this preset does not invent a universal Payload two-factor form. Custom MFA, passkeys and external identity providers remain interactive.",
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
