import type {
  HttpApplicationSettings,
  HttpAutoLoginSelectors,
} from "../../types/connection/connection";
import { PORTAINER_AUTO_LOGIN_SELECTORS } from "../../components/integrations/portainer/webUiLaunch";
import { NPM_AUTO_LOGIN_SELECTORS } from "../../components/integrations/nginxProxyMgr/webUiLaunch";
import { PROXMOX_AUTO_LOGIN_SELECTORS } from "../../components/integrations/proxmox/webUiLaunch";
import { PFSENSE_AUTO_LOGIN_SELECTORS } from "../../components/integrations/pfsense/webUiLaunch";
import { SELF_HOSTED_VAULT_PROFILES } from "./selfHostedVaultProfiles";
import { HOSTED_DASHBOARD_PROFILES } from "./hostedDashboardProfiles";
import { ANALYTICS_CMS_PROFILES } from "./analyticsCmsProfiles";

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
  /** Fixed public hosted login, never inferred from a page-supplied redirect. */
  hostedLoginUrl?: string;
  /** Safe source-reviewed path for an explicit external-browser handoff. */
  loginPath?: string;
  loginModes?: readonly HttpApplicationSettings["loginMode"][];
  requiresHttps?: boolean;
  loginFlow?: "bitwarden" | "synology" | "yealink";
}

/** Reviewed challenge DOM only. This metadata contains no authenticator secret. */
export interface HttpApplicationTotpChallenge {
  id: string;
  label: string;
  codeSelector: string;
  submitSelector: string;
  paths: readonly string[];
  submission: "post" | "spa" | "synology";
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

export const JOOMLA_VERSION_OPTIONS = [
  { value: "auto", label: "Auto-detect reviewed Joomla 3–6 forms" },
  { value: "3", label: "Joomla 3 — legacy administrator" },
  { value: "4", label: "Joomla 4 — administrator" },
  { value: "5", label: "Joomla 5 — administrator" },
  { value: "6", label: "Joomla 6 — administrator" },
] as const;

const JOOMLA_LEGACY_SUBMIT =
  'form#form-login button.login-button:not([type]), form#form-login button.login-button[type="submit"]';
const JOOMLA_MODERN_SUBMIT =
  'form#form-login button#btn-login-submit[type="submit"]';

/** Template selection only; custom overrides still take precedence at resolution. */
export function getJoomlaLoginSelectors(
  version: HttpApplicationSettings["joomlaVersion"] = "auto",
): Readonly<HttpAutoLoginSelectors> {
  return {
    usernameSelector:
      'form#form-login input#mod-login-username[name="username"]',
    passwordSelector:
      'form#form-login input#mod-login-password[name="passwd"][type="password"]',
    submitSelector:
      version === "3"
        ? JOOMLA_LEGACY_SUBMIT
        : version === "auto"
          ? `${JOOMLA_MODERN_SUBMIT}, ${JOOMLA_LEGACY_SUBMIT}`
          : JOOMLA_MODERN_SUBMIT,
  };
}

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
  ...SELF_HOSTED_VAULT_PROFILES,
  ...HOSTED_DASHBOARD_PROFILES,
  ...ANALYTICS_CMS_PROFILES,
  {
    id: "generic-form",
    label: "Generic login form",
    category: "custom",
    capability: "generic-form",
    loginModes: ["manual", "form"],
    description:
      "Explicitly opt into conservative form detection, or supply exact selectors. Advanced form options provide bounded timing, fill-only mode and explicitly configured fields. No HTTP Authorization header is added; identity-provider redirects and unsupported MFA remain interactive.",
  },
  {
    id: "http-basic",
    label: "HTTP Basic authentication",
    category: "custom",
    capability: "http-auth",
    loginModes: ["manual", "basic"],
    description:
      "Explicit HTTP Basic transport authentication to the saved origin. This is not website form login. Use HTTPS: Basic credentials are encoded, not encrypted by the authentication scheme. Credentials never follow an unrelated origin.",
  },
  {
    id: "http-digest",
    label: "HTTP Digest authentication",
    category: "custom",
    capability: "http-auth",
    loginModes: ["manual", "digest"],
    description:
      "Explicit server-challenge Digest transport authentication, not form login. Unsupported challenges fail without falling back to Basic. The saved credential remains bound to this upstream origin; HTTPS is still recommended.",
  },
  {
    id: "synology-dsm",
    label: "Synology DSM",
    category: "mailStorage",
    capability: "known-form",
    loginModes: ["manual", "form"],
    loginFlow: "synology",
    requiresHttps: true,
    totpChallenges: [
      {
        id: "synology-dsm-otp",
        label: "DSM 7 verification code",
        codeSelector:
          '#dsm-otp-fieldset input[name="one-time-code"][autocomplete="one-time-code"]',
        submitSelector: 'div[role="button"][syno-id="otp-panel-next-btn"]',
        paths: ["/", "/webman/index.cgi"],
        submission: "synology",
      },
    ],
    description:
      "Optional reviewed DSM 7 desktop username-then-password website login over HTTPS. Verification codes remain manual unless Automatic 2FA is explicitly enabled. CAPTCHA, approval, security keys, password changes and other layouts stay interactive. Website sign-in does not authorize the separate native File Station API.",
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
    hostedLoginUrl: CLOUDFLARE_DASHBOARD_URL,
    description:
      "Hosted HTTPS dashboard with interactive sign-in and two-factor authentication. No saved password, API token, or automatic form login is supplied. Use the system browser for SSO, security keys, or unsupported embedded-browser challenges.",
  },
  {
    id: "tacticalrmm",
    label: "Tactical RMM",
    category: "management",
    capability: "known-form",
    loginPath: "/login",
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
      "HTTPS dashboard account login at /login, followed by the website's separate authenticator-token prompt. Set the exact API origin below when this deployment needs a specific backend address. API keys and MeshCentral credentials are not dashboard passwords; SSO and security keys stay interactive.",
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
    id: "github",
    label: "GitHub",
    category: "management",
    capability: "known-form",
    hostedLoginUrl: "https://github.com/login",
    // Public unauthenticated github.com/login HTML reviewed September 2026.
    selectors: {
      usernameSelector:
        'form[action="/session"] input#login_field[name="login"]',
      passwordSelector:
        'form[action="/session"] input#password[name="password"][type="password"]',
      submitSelector:
        'form[action="/session"] input[name="commit"][type="submit"]',
    },
    description:
      "Reviewed GitHub.com username/email and password form. This hosted preset requires https://github.com on port 443; choose a separate custom profile for GitHub Enterprise. Authenticator, SMS, GitHub Mobile, SSO, passkey and YubiKey challenges remain interactive. Personal access tokens and SSH keys are not website passwords.",
  },
  {
    id: "gitea",
    label: "Gitea",
    category: "management",
    capability: "known-form",
    loginPath: "/user/login",
    // go-gitea/gitea v1.27.3 signin_inner.tmpl and twofa.tmpl.
    selectors: {
      usernameSelector:
        'form[action$="/user/login"] input#user_name[name="user_name"]',
      passwordSelector:
        'form[action$="/user/login"] input#password[name="password"][type="password"]',
      submitSelector: 'form[action$="/user/login"] button.ui.primary',
    },
    totpChallenges: [
      {
        id: "gitea-totp",
        label: "Gitea local-account authenticator",
        codeSelector:
          'form[action$="/user/two_factor"] input#passcode[name="passcode"][autocomplete="one-time-code"]',
        submitSelector: 'form[action$="/user/two_factor"] button.ui.primary',
        paths: ["/user/two_factor"],
        submission: "post",
      },
    ],
    description:
      "Reviewed Gitea 1.27.3 local password form and separate TOTP challenge. OAuth/OIDC providers, passkeys, SSO, CAPTCHA and custom subpath challenges remain interactive. API access tokens and Git/SSH credentials do not create a website session.",
  },
  {
    id: "drone-ci",
    label: "Drone CI",
    category: "management",
    capability: "manual",
    description:
      "Interactive sign-in through the configured Git provider's OAuth flow. Drone has no universal local username/password form; runner RPC secrets and API tokens are not browser credentials. Use the system browser for cross-origin callbacks, provider MFA or security keys.",
  },
  {
    id: "exchange-ecp",
    label: "Exchange Admin Center / ECP",
    category: "mailStorage",
    capability: "manual",
    loginPath: "/ecp/",
    description:
      "Interactive on-premises Exchange administration, normally /ecp/. Forms, Windows-integrated, ADFS and MFA behavior depend on the server and publishing setup; no guessed login form or token conversion is attempted. Exchange Online uses a different hosted admin portal. Security keys and external identity providers require their true browser origin.",
  },
  {
    id: "brevo",
    label: "Brevo",
    category: "business",
    capability: "known-form",
    hostedLoginUrl: "https://login.brevo.com/",
    usernameLabel: "Email",
    // Public login.brevo.com HTML reviewed September 2026; avoid hashed CSS.
    selectors: {
      usernameSelector: 'form input#email[name="email"]',
      passwordSelector: 'form input#password[name="password"][type="password"]',
      submitSelector:
        'form:has(input#email):has(input#password) button[data-testid="submit-button"][type="button"]',
    },
    description:
      "Reviewed hosted email/password controls at https://login.brevo.com. Authenticator/SMS codes and Google, Apple or SAML sign-in remain interactive; API/SMTP keys are not website passwords. App redirects and separate service origins may require the system browser. This preset does not claim automatic Brevo MFA.",
  },
  {
    id: "rdweb",
    label: "Windows RemoteApp / RD Web Access",
    category: "virtualization",
    capability: "manual",
    loginPath: "/RDWeb/",
    description:
      "Interactive RD Web Access portal. Legacy RDWeb, HTML5 web client, RD Gateway and Microsoft Entra preauthentication have different login/MFA flows; no universal form is guessed. Portal sign-in does not configure or launch a native RemoteApp session. Use the system browser for passkeys, security keys, external identity providers or unsupported portal launches.",
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
    loginPath: "/administrator/",
    // Reviewed Joomla 3.10, 4.1/4.2, 5.4 and 6.1 administrator mod_login forms.
    selectors: getJoomlaLoginSelectors(),
    description:
      "Reviewed Joomla 3–6 administrator forms at /administrator/. Choose auto-detection or a version-specific form and an existing custom administrator path. This does not rename Joomla's directory or bypass security extensions. Legacy same-form codes and modern captive MFA remain explicit manual steps; custom templates, security keys and SSO may need manual sign-in.",
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
  {
    id: "voip-phone",
    label: "VoIP phone (Yealink)",
    category: "networking",
    capability: "known-form",
    // The set the placeholder profile accepted, unchanged: a saved connection
    // must keep resolving after this profile gained a reviewed contract.
    loginModes: ["manual", "form", "basic", "digest"],
    loginFlow: "yealink",
    // Mirrors `servlet::SEL_*` in
    // `src-tauri/crates/sorng-voip-phone/src/endpoints.rs` — keep them equal.
    // Both attested T2x markups are listed: the confirm control is an `<a>`
    // that calls the page's own script, so a submit-button search finds
    // nothing and only this override reaches it.
    selectors: {
      usernameSelector: '#idUsername, input[name="username"]',
      passwordSelector: '#idPassword, input[name="pwd"][type="password"]',
      submitSelector: '#idConfirm, input[type="submit"][name="login"]',
    },
    description:
      "Reviewed Yealink T2x desk-phone web login, covering the current and older login-page markup. The phone's own page script encrypts the password with a per-session key, so filling the form is not enough by itself: automatic sign-in stays incomplete until the embedded viewer's page-script compatibility update ships, and signing in remains a manual step until then. Choose Basic only for the older /cgi-bin/ConfigManApp.com firmware generation; the servlet web UI does not accept HTTP Basic. The phone permits one web session at a time, so signing in from here can end a session you have open on the phone in another browser. A rejected or locked-out sign-in stops and is never retried, because repeated failures lock the account for several minutes. Newer T4x/T5x JSON-API firmware is not covered.",
  },
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
  if (profile.loginModes) return [...profile.loginModes];
  return profile.capability === "http-auth"
    ? ["manual", "basic", "digest"]
    : ["manual", "form", "basic", "digest"];
}

/** Allowlisted, bounded metadata only; invalid imports must not fall back to legacy Basic. */
/** Deliberately pathname-only: no URL, encoded separator, traversal or query secret. */
export function isSafeHttpApplicationLoginPath(
  value: unknown,
): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 512 &&
    /^\/(?:[A-Za-z0-9._~-]+\/)*[A-Za-z0-9._~-]*$/.test(value) &&
    !value.split("/").some((segment) => segment === "." || segment === "..")
  );
}

/** Canonical, non-secret Tactical API authority; never discard URL secrets or paths. */
export function normalizeTacticalRmmApiOrigin(
  value: unknown,
): string | undefined {
  if (
    typeof value !== "string" ||
    value.length > 2048 ||
    !/^https:\/\/[^/?#\\@%\s]+\/?$/i.test(value)
  )
    return undefined;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.port ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

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
    loginMode === "manual" ||
    loginMode === "basic" ||
    loginMode === "digest" ||
    loginMode === "form";
  const realmValid =
    raw.realm === undefined ||
    (safeString(raw.realm, 128) && /^[A-Za-z0-9._-]+$/.test(raw.realm));
  const loginPathValid =
    raw.loginPath === undefined ||
    (id === "joomla" && isSafeHttpApplicationLoginPath(raw.loginPath));
  const joomlaVersionValid =
    raw.joomlaVersion === undefined ||
    (id === "joomla" &&
      JOOMLA_VERSION_OPTIONS.some(({ value }) => value === raw.joomlaVersion));
  const apiOrigin =
    id === "tacticalrmm"
      ? normalizeTacticalRmmApiOrigin(raw.apiOrigin)
      : undefined;
  const apiOriginValid = raw.apiOrigin === undefined || apiOrigin !== undefined;
  const valid =
    raw.version === 1 &&
    !!profile &&
    validMode &&
    getHttpApplicationLoginModes(profile).includes(loginMode) &&
    realmValid &&
    loginPathValid &&
    joomlaVersionValid &&
    apiOriginValid &&
    raw.invalid !== true;
  return {
    version: 1,
    id,
    loginMode: validMode ? loginMode : "manual",
    ...(apiOrigin ? { apiOrigin } : {}),
    ...(id === "proxmox" && realmValid && typeof raw.realm === "string"
      ? { realm: raw.realm }
      : {}),
    ...(loginPathValid && typeof raw.loginPath === "string"
      ? { loginPath: raw.loginPath }
      : {}),
    ...(joomlaVersionValid && raw.joomlaVersion !== undefined
      ? {
          joomlaVersion:
            raw.joomlaVersion as HttpApplicationSettings["joomlaVersion"],
        }
      : {}),
    ...(!valid ? { invalid: true as const } : {}),
  };
}
